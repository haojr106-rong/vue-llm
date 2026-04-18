// src/api/deepseek.js
// 功能：封装 DeepSeek AI 接口的请求逻辑，主要实现流式对话功能
// 依赖：axios（网络请求）、element-plus（消息提示）、DeepSeek API Key 配置

// 导入axios用于发起HTTP请求
import axios from "axios";
// 导入element-plus的消息提示组件，用于错误提示
import { ElMessage } from "element-plus";

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
  // 记录已处理的内容片段数量，避免重复处理
  let processedContentChunks = 0;
  // 记录已处理的推理片段数量，避免重复处理
  let processedReasonChunks = 0;

  // tokens 这个是ai回复的数据，如果书数组类型["哈", "哈", "大", "笑"]需要把他拆成单个字符，
  // callback 是处理函数比如adddelta为实参
  const emitTokens = (tokens, callback) => {
    // 校验参数合法性：回调函数不存在/内容为空时直接返回
    if (!callback || tokens === undefined || tokens === null) {
      return;
    }
    // 如果是数组类型，遍历每个token并调用回调
    if (Array.isArray(tokens)) {
      tokens.forEach((token) => callback(token));
    } else {
      // 非数组类型直接调用回调
      callback(tokens);
    }
  };


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
        // 获取当前已返回的所有响应内容
        const chunk = evt.event.currentTarget.response;
        // 按换行分割内容，过滤出以"data: "开头的有效SSE格式行
        const lines = chunk
          .split("\n")//变为对象数组以换行分割
          .filter((line) => line.startsWith("data: "));

        // 用于标记当前处理的内容片段索引
        let index = 0;
        // 用于标记当前处理的推理片段索引
        let reasonIndex = 0;

        // 遍历每一行有效数据
        for (const line of lines) {
          // 检测到结束标记时，触发完成回调并终止循环
          if (line === "data: [DONE]") {
            onDone?.();
            return;
          }

          try {//这里是解析思考过程
            // 解析JSON数据：去除前缀"data: "后转为对象，JSON.parse会凭空制造新的数组或者对象因为‘里面是对象’
            const payload = JSON.parse(line.slice(6));
            // 提取推理内容片段（delta表示增量）
            // [
            //   'data: {"id": "1", "choices": [{"delta": {"content": "你"}}]}',  // 第 1 行 (文本)
            //   {"id": "2", "choices": [{"delta": {"content": "好"}}，...........]}  // 解析完变为对象
            // ]  reasoning_content思考过程
            const reasoning = payload.choices?.[0]?.delta?.reasoning_content;
            // 处理推理内容
            if (reasoning) {
              // 仅处理未处理过的推理片段（避免重复回调）
              if (reasonIndex >= processedReasonChunks) {
                // 分发推理内容到对应的回调函数
                emitTokens(reasoning, onReasoning);
                // 更新已处理的推理片段计数
                processedReasonChunks++;
              }
              // 推进推理片段索引
              reasonIndex++;
            }

            // 这里是提取真实的回复
            const delta = payload.choices?.[0]?.delta?.content;
            // 处理对话内容
            if (delta) {
              // 仅处理未处理过的内容片段（避免重复回调）
              if (index >= processedContentChunks) {
                // 分发对话内容到对应的回调函数
                emitTokens(delta, onChunk);
                // 更新已处理的内容片段计数
                processedContentChunks++;
              }
              // 推进内容片段索引
              index++;
            }
          } catch (error) {
            // 捕获错误：如果是手动取消请求，触发完成回调
            if (axios.isCancel(error)) {
              onDone?.();
            } else {
              // 其他错误重新抛出，交由响应拦截器处理
              throw error;
            }
          }
        }
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
