// src/api/deepseek.js
// 功能：封装 DeepSeek AI 接口的请求逻辑，主要实现流式对话功能
// 依赖：axios（网络请求）、element-plus（消息提示）、DeepSeek API Key 配置

// 导入axios用于发起HTTP请求
import axios from "axios";
// 导入element-plus的消息提示组件，用于错误提示
import { ElMessage } from "element-plus";
import { IncrementalSseParser } from "@/utils/incrementalSseParser";

// 导入DeepSeek API密钥配置
import { DEEPSEEK_API_KEY } from "@/config/deepseekKey";

// 创建axios实例，配置DeepSeek接口基础信息
const api = axios.create({
  // DeepSeek API的基础请求地址
  baseURL: "https://api.deepseek.com/v1",
  // 请求超时时间设置为4分钟（240000毫秒），适配流式响应的长连接
  timeout: 240000,
});

// 用于存储当前请求的中止控制器，实现手动取消请求的功能
let currentAbortController = null;

//请求拦截器，发送前最后一次检查。响应拦截器，接收信息前的第一次检查

// 🔐 请求拦截器：给所有请求自动加上 Bearer（持有者） Token（令牌）
//axios自己再合适时机调用，把一个箭头函数给use方法
api.interceptors.request.use((config) => {
  // 获取并去除API Key两端的空白字符
  const apiKey = (DEEPSEEK_API_KEY ?? "").trim();
  // 设置请求头：添加Authorization认证，格式为Bearer + API Key
  config.headers["Authorization"] = `Bearer ${apiKey || ""}`;
  // 设置请求内容类型为JSON格式
  config.headers["Content-Type"] = "application/json";
  // 设置接受的响应类型为文本事件流（适配流式响应）
  config.headers["Accept"] = "text/event-stream";

  // 每次请求创建新的AbortController，用于后续可取消请求，js自带的中断器；
  currentAbortController = new AbortController();
  // 将中止信号绑定到请求配置中
  config.signal = currentAbortController.signal;

  return config;
});

// ❗️响应拦截器：统一处理错误
api.interceptors.response.use(
  // 响应成功时直接返回响应数据
  (res) => res,
  // 响应失败时统一处理错误
  (err) => {
    // 排除手动取消请求的情况（避免误提示）
    if (!axios.isCancel(err)) {
      // 优先获取接口返回的错误信息，无则使用默认提示"网络异常"
      const msg = err.response?.data?.error?.message || "网络异常";
      // 显示错误提示弹窗
      ElMessage.error(msg);
    }
    // 将错误继续抛出，供上层调用方处理
    return Promise.reject(err);
  },
);

// 🌊 流式对话（核心函数）
/**
 * 调用 DeepSeek 接口获取流式响应。
 * @param {Array} messages 上下文消息数组，格式为[{role: 'user/assistant', content: '消息内容'}]
 * @param {Function} onChunk 内容增量回调，接收每次返回的文本片段
 * @param {Function} onDone 完成回调，流式响应结束时触发
 * @param {Function} onReasoning 推理内容回调，接收推理过程的文本片段
 * @param {string} model 调用的模型名称，默认值为"deepseek-reasoner"
 */
export async function chatStream(
  messages,
  onChunk,
  onDone,
  onReasoning,
  model = "deepseek-reasoner",
) {
  // 每次请求使用独立解析器，避免不同会话之间共享解析状态。
  const parser = new IncrementalSseParser({
    onContent: onChunk,
    onReasoning,
    onDone,
  });

  // 发起POST请求调用DeepSeek流式对话接口
  await api.post(
    // 接口路径：聊天补全接口
    "/chat/completions",
    // 请求体参数
    {
      // 使用传入的模型名称，默认值为deepseek-reasoner
      model: model || "deepseek-reasoner",
      // 上下文消息列表
      messages,
      // 开启流式响应模式
      stream: true,
    },
    // 请求配置项
    {
      // 响应类型设置为文本，适配流式数据解析
      responseType: "text",
      // 下载进度回调（核心：处理流式返回的每一段数据）
      onDownloadProgress(evt) {
        // Axios 提供累计响应文本；解析器只读取新增字符，并把尚未
        // 完整结束的 SSE 事件保留到下一次回调继续拼接。
        const cumulativeResponse = evt.event.currentTarget.response;
        parser.push(cumulativeResponse);
      },
    },
  );
}

/**
 * 中止当前正在进行的流式请求
 * 功能：调用AbortController的abort方法取消请求，并清空控制器实例
 */
export function abortStream() {
  // 检查是否存在有效的中止控制器
  if (currentAbortController) {
    // 执行中止操作
    currentAbortController.abort();
    // 清空控制器实例，释放资源，终止器用过了就报废了，但是下一次发送会创建新的覆盖旧的，
    // 这里大概率是因为假如null 就可以控制组件变为发送组件停用，多了一个判断条件，重新发送就会显示新的终止器，就可以继续点击暂停了
    currentAbortController = null;
  }
}
