<!-- 这是一个支持文本输入、文件上传解析、语音识别的聊天输入组件
 可提交内容并控制 AI 生成启停。 -->

<script setup>
// 导入 Element Plus 图标组件
import {
  CircleClose,
  Close,
  Microphone,
  Paperclip,
  Promotion,
  UploadFilled,
} from "@element-plus/icons-vue";
// 导入 Element Plus 消息提示和弹窗组件
import { ElMessage, ElMessageBox } from "element-plus";
// 导入 JSZip 用于解析 DOCX 文件（DOCX 本质是 ZIP 压缩包）
import JSZip from "jszip";
// 导入 Vue 3 组合式 API 核心方法
import {
  computed,
  defineEmits,
  defineProps,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

// 导入 DeepSeek 流式响应终止方法
import { abortStream } from "@/apis/deepseek";
// 导入 PDF 解析库（兼容旧版构建方式），把导入的内容打包为一个对象
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// 导入 PDF 解析专用的 Worker 线程（通过 Vite 路径别名处理）
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";

// 定义组件名称（Vue 3 组件标识）
defineOptions({ name: "ChatInput" });

// 配置 PDF.js 的全局 Worker 路径，避免主线程阻塞
if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

// ---------------------- Props 定义 ----------------------
// 定义组件接收的属性，实现父子组件状态通信
const props = defineProps({
  // 输入框的消息内容（双向绑定）
  msg: {
    type: String,
    default: "",
  },
  // 是否正在生成回答（用于控制按钮状态/语音录制）
  isTyping: {
    type: Boolean,
    default: false,
  },
});

// ---------------------- 事件定义 ----------------------
// 定义组件向外触发的事件，实现子向父传值
// update:msg = 输入框文字变了，同步给父组件（双向绑定）update submit都是固定的
// submit = 用户点发送，把内容交给父组件处理
const emit = defineEmits(["update:msg", "update:isTyping", "submit"]);

// ---------------------- 计算属性：双向绑定代理 ----------------------
/**
 * 文本输入框的双向绑定代理
 * 作用：将父组件的 msg 状态透传到子组件输入框，修改时同步通知父组件
 */
const inputText = computed({
  get: () => props.msg, // 读取父组件传入的 msg
  set: (val) => emit("update:msg", val), // 修改时触发事件更新父组件状态
});

/**
 * 生成状态的双向绑定代理
 * 作用：同步父组件的 isTyping 状态，修改时通知父组件
 * isTyping = true 表示ai在生成内容
 */
const isTyping = computed({
  get: () => props.isTyping,
  set: (val) => emit("update:isTyping", val),
});

// ---------------------- 响应式数据 ----------------------
// 1文本域 DOM 引用（用于手动调整高度）
const textarea = ref(null);
// 3文件上传输入框 DOM 引用（用于触发文件选择）
const fileInput = ref(null);
// 2已上传的附件列表（存储文件元信息和解析后的文本）
const attachments = ref([]);
// 5语音识别实时预览文本
const speechPreview = ref("");
// 6是否正在进行语音录制
const isRecording = ref(false);
// 4语音识别实例（Web Speech API）
const recognition = ref(null);

// ---------------------- 常量定义：文件上传规则 ----------------------
/**
 * 允许上传的文件扩展名集合
 * 涵盖常见文本、文档、代码文件类型，限制非预期文件上传
 * set数组自动去重复返回值长这样Set(3) {'txt', 'pdf', 'docx'}
 */
const ALLOWED_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "log", "pdf", "doc", "docx", "xml", "yml", "yaml",
  "html", "css", "scss", "less", "js", "jsx", "ts", "tsx", "vue", "py", "java",
  "c", "cpp", "cc", "h", "hpp", "cs", "php", "rb", "go", "rs", "kt", "swift",
  "sql", "sh",
]);

/**
 * 允许上传的文件 MIME 类型集合
 * 补充扩展名判断，适配部分浏览器仅返回 MIME Type 的场景
 */
const ALLOWED_MIME_TYPES = new Set([
  "text/plain", "text/csv", "text/markdown", "application/json",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml", "text/xml", "text/html", "text/css",
  "text/x-python", "text/x-java-source", "text/x-c", "text/x-c++",
  "text/x-script.python", "application/javascript", "text/javascript",
]);

/**
 * 文件选择框的 accept 属性值
 * 作用：在文件选择弹窗中过滤仅显示允许的文件类型，提升用户体验
 */
const acceptAttribute = computed(() =>
  Array.from(ALLOWED_EXTENSIONS)
    .map((ext) => `.${ext}`) // 转换为 .ext 格式（如 .txt）
    .join(","), // 拼接为 accept 要求的字符串格式
);

// ---------------------- 计算属性：界面展示逻辑 ----------------------

/**
 * 发送按钮禁用状态
 * 规则：输入框无内容 且 无附件时禁用，避免空提交
 */
const sendDisabled = computed(
  () => !inputText.value.trim() && attachments.value.length === 0,
);

/**
 * 浏览器是否支持语音识别
 * 检测 Web Speech API 兼容性，决定是否显示语音按钮
 */
const isSpeechSupported = computed(
  () =>
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window),

);

/**
 * 输入框占位符文本
 * 根据浏览器是否支持语音识别，动态显示不同提示语
 */
const placeholder = computed(() =>
  isSpeechSupported.value
    ? "输入你的问题，或点击语音输入按钮试试看…"
    : "输入你的问题…",
);


// ---------------------- 工具方法：输入框高度自适应 ----------------------
/**
 * 调整文本域高度
 * 逻辑：自动适配内容高度，限制最小/最大高度，超出后显示滚动条
 */
const resize = () => {
  const el = textarea.value;//el是输入框dom元素
  if (!el) return;

  const minHeight = 120; // 输入框最小高度（px）
  const maxHeight = 240; // 输入框最大高度（px）
  el.style.height = "auto"; // 重置高度为自动计算
  // 计算目标高度：不小于最小高度，不大于最大高度
  const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);//el.scrollHeight这个是文字堆叠的高度
  el.style.height = `${nextHeight}px`;
  // 超出最大高度时显示垂直滚动条，否则隐藏
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
};

// ---------------------- 工具方法：文件大小格式化 ----------------------
/**
 * 格式化文件大小（字节转易读格式）
 * @param {number} size - 文件字节数
 * @returns {string} 格式化后的大小（如 1.2 KB、2.5 MB）
 */
const formatSize = (size) => {
  if (size < 1024) return `${size} B`; // 小于 1KB 显示字节
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; // 小于 1MB 显示 KB
  return `${(size / (1024 * 1024)).toFixed(1)} MB`; // 大于等于 1MB 显示 MB
};

// ---------------------- 常量：文件上传限制 ----------------------
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 文件最大体积：8MB
const MAX_TEXT_PREVIEW = 8000; // 文本预览最大字符数：8000

// ---------------------- 工具方法：生成唯一 ID ----------------------
/**
 * 生成附件唯一 ID
 * 优先使用浏览器原生 UUID API，降级使用时间戳+随机数, crypto为浏览器内置对象
 * @returns {string} 唯一 ID
 */
const createAttachmentId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID(); // 现代浏览器原生 UUID
  }
  // 降级方案：时间戳 + 随机 16 进制数，随机数变为16进制toString(16)
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

// ---------------------- 工具方法：文本截断 ----------------------
/**
 * 截断长文本并添加提示
 * @param {string} text - 原始文本
 * @returns {object} { body: 截断后的文本, note: 截断提示 }
 */
const truncatePreview = (text = "") => {
  const trimmed = text.trim();
  const body = trimmed.slice(0, MAX_TEXT_PREVIEW); // 截取前 8000 字符
  const note =
    trimmed.length > MAX_TEXT_PREVIEW
      ? "内容已截断，仅展示前 8000 字符"
      : "";
  return { body, note };
};

// ---------------------- 工具方法：文件内容读取 ----------------------
/**
 * 读取文件为纯文本
 * @param {File} file - 文件对象
 * @returns {Promise<{body: string, note: string}>} 解析结果
 */
// 定义一个函数 readAsPlainText，接收一个文件 file，作用是读取文件的纯文本内容
const readAsPlainText = (file) =>
  // 返回一个 Promise 对象（异步操作固定写法，成功后用 resolve 返回结果）
  new Promise((resolve) => {
    // 创建文件读取器：浏览器自带的 FileReader，专门用来读取本地文件内容
    const reader = new FileReader();

    // 注册监听：当文件读取完成时，自动执行这个函数
    reader.onload = () => {
      // 读取到的结果：reader.result 是文件内容，?? 表示如果为空就用空字符串 "" 代替
      // 再转成字符串，确保拿到纯文本
      const result = (reader.result ?? "").toString();

      // 把读取到的内容截断处理（超过8000字就切掉），然后把结果返回出去
      resolve(truncatePreview(result));
    };//  加{}无return意思是无需返回值

    // 真正开始读取文件：以 UTF-8 纯文本格式读取这个文件
    reader.readAsText(file, "utf-8");
  });

/**
 * 💡
 * 解析 DOCX 文件提取文本内容
 * DOCX 本质是 ZIP 压缩包，核心内容在 word/document.xml 中
 * @param {File} file - DOCX 文件对象
 * @returns {Promise<{body: string, note: string}>} 解析结果
 */
// 定义异步函数 extractDocxText，用于从 DOCX 文件中提取文本内容
const extractDocxText = async (file) => {
  // 尝试执行文件解析逻辑，捕获可能出现的异常
  try {
    // 将上传的 File 对象转换为 ArrayBuffer 二进制数据，用于后续解析
    const arrayBuffer = await file.arrayBuffer();

    // 使用 JSZip 库加载 ArrayBuffer 格式的 ZIP 包（DOCX 本质是 ZIP 压缩文件）
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 从 ZIP 包中获取 DOCX 核心的正文 XML 文件：word/document.xml
    const documentFile = zip.file("word/document.xml");

    // 判断是否成功获取到核心 XML 文件
    if (!documentFile) {
      // 未找到文件时，返回空正文和提示信息
      return {
        body: "",
        note: "未能解析 DOCX 正文内容，已附带文件信息。",
      };
    }

    // 将获取到的 XML 文件以字符串形式异步读取出来
    const xml = await documentFile.async("string");

    // 创建 DOMParser 实例，用于解析 XML 字符串为 DOM 文档
    const parser = new DOMParser();

    // 把 XML 字符串解析为可操作的 XML DOM 对象
    const doc = parser.parseFromString(xml, "application/xml");

    // 获取 XML 中所有的段落标签 <w:p>，并转为数组方便遍历
    const paragraphs = Array.from(doc.getElementsByTagName("w:p"));

    // 遍历所有段落，提取每个段落内的文本标签 <w:t> 内容
    const text = paragraphs
      .map((p) =>
        // 对每个段落，提取内部所有 <w:t> 标签的文本内容并拼接
        Array.from(p.getElementsByTagName("w:t"))
          .map((node) => node.textContent) // 获取文本节点的纯文本
          .join(""), // 把一个段落内的所有文本拼接成一行
      )
      .join("\n") // 段落之间用换行符分隔
      .replace(/\n{3,}/g, "\n\n"); // 正则替换：把连续3个及以上换行替换成2个，清理多余空行

    // 判断提取到的文本是否为空（去除首尾空白后）
    if (!text.trim()) {
      // 文本为空时返回空正文和对应提示
      return {
        body: "",
        note: "DOCX 文件未检测到可提取的文本内容。",
      };
    }

    // 文本提取成功，调用 truncatePreview 函数做长度截断/预览处理后返回
    return truncatePreview(text);

  // 捕获解析过程中任何可能的错误（文件损坏、格式异常、解析失败等）
  } catch (error) {
    // 在控制台打印错误信息，方便调试
    console.error("Failed to extract DOCX", error);

    // 解析出错时返回空正文和错误提示
    return {
      body: "",
      note: "解析 DOCX 文件时出错，已附带文件元信息。",
    };
  }
};

/**
 * 解析 PDF 文件提取文本内容
 * 使用 pdfjsLib 逐页读取文本，避免大文件卡顿
 * @param {File} file - PDF 文件对象
 * @returns {Promise<{body: string, note: string}>} 解析结果
 */

const extractPdfText = async (file) => {
  // 尝试执行 PDF 解析逻辑，捕获所有可能的异常
  try {
    // 将上传的 File 对象转换为 ArrayBuffer 二进制数据，供 PDF.js 解析
    const arrayBuffer = await file.arrayBuffer();

    // 使用 pdfjsLib 加载 PDF 文档（内部启用 Worker 线程，防止阻塞主线程）
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // 创建数组 chunks，用于存储每一页提取出来的文本
    const chunks = [];

    // 逐页循环解析 PDF（从第 1 页开始，到总页数结束）
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      // 获取当前页码对应的 PDF 页面对象
      const page = await pdf.getPage(pageNumber);

      // 获取当前页面的文本内容（返回包含所有文字块的对象）
      const content = await page.getTextContent();

      // 处理当前页面的文本内容：提取文字、合并空格、清理格式
      const pageText = content.items
        // 遍历页面中的每一个文本块，判断是否包含 str 属性，有则提取文字
        .map((item) => ("str" in item ? item.str : ""))
        // 把所有文本块用空格连接成一整段文字
        .join(" ")
        // 正则替换：把多个连续空白符（空格/换行/制表符）替换成单个空格
        .replace(/\s+/g, " ")
        // 去除文本首尾多余的空白字符
        .trim();

      // 如果当前页面提取到了有效文本，就存入 chunks 数组
      if (pageText) {
        chunks.push(pageText);
      }

      // 性能优化：如果总文本长度超过阈值（预览最大长度的1.5倍），立即停止继续解析页面
      if (chunks.join("\n\n").length > MAX_TEXT_PREVIEW * 1.5) {
        break;
      }
    }

    // 把所有页面的文本用两个换行符连接，形成完整的文档文本
    const combined = chunks.join("\n\n");

    // 判断提取到的文本是否为空（去除首尾空白后）
    if (!combined.trim()) {
      // 无有效文本时，返回空正文和提示信息
      return {
        body: "",
        note: "PDF 文件未检测到可提取的文本内容。",
      };
    }

    // 文本提取成功，调用截断函数处理后返回最终预览文本
    return truncatePreview(combined);

  // 捕获解析过程中所有错误（文件损坏、加密PDF、格式异常、加载失败等）
  } catch (error) {
    // 控制台打印错误日志，方便调试定位问题
    console.error("Failed to extract PDF", error);

    // 解析失败时返回空正文和错误提示
    return {
      body: "",
      note: "解析 PDF 文件时出错，已附带文件元信息。",
    };
  }
};

/**
 * 统一读取文件内容入口
 * 根据文件类型选择对应的解析方法
 * @param {File} file - 文件对象
 * @returns {Promise<{body: string, note: string}>} 解析结果
 */
const readFileContent = async (file) => {
  const name = file.name || "";
  const type = file.type || "";

  // 纯文本类文件：直接读取为文本，startsWith检查开头，includes检查全文，
  //  正则表达式核心：匹配以 .md/.txt/.csv/.json/.log 结尾的文件名（不区分大小写）
  // 拆解说明：
  // /.../i ：正则表达式的定界符，i 表示忽略大小写（ignore case）
  // \.     ：匹配字面量的点（.），因为 . 在正则中是特殊字符，需用 \ 转义
  // (md|txt|csv|json|log) ：分组匹配，| 表示“或”，匹配 md、txt、csv、json、log 中的任意一个
  // $      ：匹配字符串的结束位置，确保后缀出现在文件名最后
  // test(name) ：正则的 test 方法，检测 name 字符串是否符合该正则规则，返回布尔值（true/false）
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    /\.(md|txt|csv|json|log)$/i.test(name)
  ) {
    return readAsPlainText(file);//作用是将文件（File/Blob 对象）以纯文本格式读取
  }

  // DOCX 文件：解析 XML 提取文本
  if (/\.docx$/i.test(name) || type.includes("officedocument.wordprocessingml")) {
    return extractDocxText(file);
  }

  // PDF 文件：使用 pdfjs 提取文本
  if (/\.pdf$/i.test(name) || type === "application/pdf") {
    return extractPdfText(file);//自定义函数
  }

  // 其他文件：仅记录元信息，不提取文本
  return {
    body: "",
    note: "该文件为非文本格式，已附带元信息供参考。",
  };
};

/**
 * 校验文件类型是否允许上传
 * 优先按扩展名判断，降级按 MIME Type 判断
 * @param {File} file - 文件对象
 * @returns {boolean} 是否允许上传
 */
const isFileTypeAllowed = (file) => {
  const name = file.name || "";
  //split() 是字符串的方法，作用是按照指定的分隔符，把一个字符串分割成数组，返回分割后的新数组，原字符串不会变，
  // // 例子1：普通文件名 "笔记.txt"，"笔记.txt".split("."); // ["笔记", "txt"]
  //pop() 是数组的方法，作用是删除并返回数组的最后一个元素
  //toLowerCase()：把字符串转 “小写”
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const type = (file.type || "").toLowerCase();

  if (extension && ALLOWED_EXTENSIONS.has(extension)) {
    return true;
  }

  if (type && ALLOWED_MIME_TYPES.has(type)) {
    return true;
  }

  return false;
};

/**
 * 显示不支持文件类型的弹窗提示
 * 居中弹窗，告知用户不支持的原因
 * @param {File} file - 文件对象
 * @returns {Promise} 弹窗 Promise
 */
const showUnsupportedFileAlert = (file) =>
  ElMessageBox.alert(   // 好看的弹窗
    `${file.name || "该文件"} 的格式暂不支持，请上传文本、文档或常见代码文件。`,
    "文件类型不支持",
    {
      confirmButtonText: "我知道了",
      center: true, // 弹窗居中显示
    },
  );

// ---------------------- 事件处理：文件上传 ----------------------
/**
 * 处理文件选择框变更事件
 * 批量校验、解析文件，添加到附件列表
 * @param {Event} event - 输入框变更事件
 */
const handleFileChange = async (event) => {
  const files = Array.from(event.target.files || []);//Array.from转化为数组
  if (!files.length) return;

  for (const file of files) {
    // 校验文件类型：不支持则提示并跳过
    if (!isFileTypeAllowed(file)) {
      await showUnsupportedFileAlert(file);
      continue;   //  跳过后续代码，继续执行for的第二项
    }

    // 校验文件大小：超过 8MB 则提示并跳过
    if (file.size > MAX_FILE_SIZE) {
      ElMessage.warning(`${file.name} 超过 ${formatSize(MAX_FILE_SIZE)}，已忽略`);
      continue;
    }

    // 解析文件内容并添加到附件列表
    const { body, note } = await readFileContent(file);
    attachments.value.push({
      id: createAttachmentId(), // 唯一标识
      name: file.name, // 文件名
      size: file.size, // 文件大小（字节）
      type: file.type || "unknown", // 文件 MIME 类型
      body, // 解析后的文本内容
      note, // 解析备注（如截断提示、错误提示）
      addedAt: Date.now(), // 添加时间戳
    });
  }

  // 清空文件输入框（允许重复选择同一文件），从无到有浏览器才会觉得变了，才会上传同一文件，
  event.target.value = "";
  // 等待 DOM 更新后调整输入框高度
  await nextTick();//nextTick 监听dom重新渲染，加了await是等他监听完
  resize();
};

/**
 * 移除指定附件
 * @param {string} id - 附件唯一 ID
 */
const removeAttachment = (id) => {
  attachments.value = attachments.value.filter((item) => item.id !== id);  // 比如删除3号，不是三号的留下
};

/**
 * 触发文件选择框点击
 * 用于绑定到附件图标点击事件
 */
const triggerFilePicker = () => {
  fileInput.value?.click();
};

// ---------------------- 事件处理：提交 ----------------------
/**
 * 处理提交事件
 * 触发父组件 submit 事件，传递输入内容和附件，然后清空状态
 */
const handleSubmit = () => {
  if (sendDisabled.value) return; // 禁用状态下不执行
  // 触发提交事件，传递附件副本（避免父组件修改原数组）
  emit("submit", {
    attachments: attachments.value.map((item) => ({ ...item })),
  });
  // 清空附件和语音预览
  attachments.value = [];
  speechPreview.value = "";
  // 调整输入框高度
  nextTick(() => {
    resize();
  });
};

/**
 * 处理文本框回车键（Enter）的核心函数
 * 区分 Shift+Enter（插入换行）和 普通Enter（提交）两种逻辑
 * @param {KeyboardEvent} event - 键盘事件对象，包含按键状态（如shiftKey）
 */
const handleEnter = (event) => {
  // 判断是否按下 Shift 键（Shift+Enter 组合键）
  if (event.shiftKey) {
    // Shift+Enter 逻辑：在光标位置插入换行符，不提交

    // 获取textarea DOM元素
    const el = textarea.value;
    // 防错处理：如果textarea元素不存在，直接终止函数
    if (!el) return;

    // 获取文本框当前光标/选中区域的起止位置
    // selectionStart：光标起始位置（未选中时=selectionEnd）
    // selectionEnd：光标结束位置（选中文字时为选中区域末尾）
    const { selectionStart, selectionEnd } = el;
    // 获取文本框当前绑定的响应式内容
    const value = inputText.value;

    // 在光标位置插入换行符\n：
    // 1. value.slice(0, selectionStart) → 光标前的所有内容
    // 2. \n → 插入的换行符
    // 3. value.slice(selectionEnd) → 光标后的所有内容
    const newValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
    //slice只有一个参数表示从这个到尾

    // 更新文本框内容为插入换行后的新内容
    inputText.value = newValue;

    // 等待Vue异步更新DOM完成后（textarea内容刷新），再调整光标和高度
    nextTick(() => {
      // 调整光标位置：移到插入的换行符后面（原光标位置+1）
      // 同时设置selectionStart=selectionEnd，取消选中状态，保证光标为单个位置,+1是因为换行符/n只是占一个字符长度
      el.selectionStart = el.selectionEnd = selectionStart + 1;
      // 调用resize函数，适配换行后文本框的高度（避免内容溢出）
      resize();
    });

    // 终止函数执行，避免触发后续的普通Enter提交逻辑
    return;
  }
  // 普通Enter逻辑（未按Shift键）：直接触发提交操作
  handleSubmit();
};

/**
 * 停止回答生成
 * 调用 DeepSeek API 的终止方法，中断流式响应
 */
const stopGeneration = () => {
  abortStream();
};

// ---------------------- 语音识别相关 ----------------------
/**
 * 初始化语音识别实例
 * 懒加载方式创建实例，避免不必要的资源占用
 */
const ensureRecognition = () => {
  if (!isSpeechSupported.value || recognition.value) return;

  // 兼容不同浏览器的 SpeechRecognition 前缀
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const instance = new SpeechRecognition();
  instance.lang = "zh-CN"; // 设置识别语言为中文
  instance.interimResults = true; // 启用实时中间结果
  instance.continuous = true; // 启用连续识别

  // 语音识别结果回调
  instance.onresult = (event) => {
    let finalText = ""; // 最终识别结果（已确认）
    let interimText = ""; // 临时识别结果（未确认）

    // 遍历所有识别结果
    for (const result of event.results) {
      if (result.isFinal) {//停止说话isFinal变为true，你一直说浏览器实时猜测调整你输出的内容，
      // result[0]浏览器猜的第一段话，
        finalText += result[0].transcript; // 最终结果合并到输入框，transcript副本
      } else {
        interimText += result[0].transcript; // 临时结果显示在预览
      }
    }

    // 最终结果合并到输入框
    if (finalText) {
      inputText.value = `${inputText.value} ${finalText}`.trim();
      nextTick(resize); // 调整输入框高度，和上面写法等效，都要等dom更新
    }

    // 临时结果更新预览
    speechPreview.value = interimText;
  };

  // 语音识别错误回调：停止录制
  instance.onerror = () => {
    stopRecording();
  };

  // 语音识别结束回调：停止录制
  instance.onend = () => {
    stopRecording();
  };

  recognition.value = instance;
};

/**
 * 开始语音录制
 * 初始化识别实例并启动，处理异常情况
 */
const startRecording = () => {
  if (!isSpeechSupported.value || isRecording.value) return;
  ensureRecognition();
  try {
    recognition.value?.start();
    isRecording.value = true;
    speechPreview.value = "正在听…"; // 更新预览提示
  } catch (error) {
    console.error(error);
    ElMessage.error("无法启动语音识别"); // 错误提示
    isRecording.value = false;
  }
};

/**
 * 停止语音录制
 * 终止识别实例，重置状态
 */
const stopRecording = () => {
  if (recognition.value && typeof recognition.value.stop === "function") {
    recognition.value.stop();
  }
  isRecording.value = false;
  speechPreview.value = ""; // 清空预览
};

/**
 * 切换语音录制状态
 * 开始/停止录制的统一入口，true/false，控制状态
 */
const toggleRecording = () => {
  if (isRecording.value) {
    stopRecording();
  } else {
    startRecording();
  }
};

// ---------------------- 生命周期钩子 ----------------------
/**
 * 组件挂载后执行
 * 初始化输入框高度
 */
onMounted(() => {
  resize();
});

/**
 * 组件卸载前执行
 * 停止语音录制，避免内存泄漏
 */
onBeforeUnmount(() => {
  stopRecording();
});

// ---------------------- 监听器 ----------------------
/**
 * 监听输入框内容变化
 * 内容清空时重新调整高度，保持输入框紧凑
 */
watch(inputText, (value) => { //  只有一个参数就是新值
  if (!value.trim()) {
    nextTick(resize);
  }
});

/**
 * 监听生成状态变化
 * ai开始生成回答时立即停止语音识别，避免录音状态悬挂
 */
watch(isTyping, (value) => {
  if (value) {
    stopRecording();
  }
});
</script>


<template>
  <!-- 整体容器：包裹输入区、操作区、文件上传隐藏输入框，是整个输入组件的根容器 -->
  <div class="container">
    <!-- 输入区域容器：包含文本输入框、附件列表、语音预览、工具栏，负责用户输入相关的所有UI展示 -->
    <div class="input-area">
      <!-- 文本输入框组件：
           核心功能：提供多行文本输入能力，支持自适应高度、回车提交、Shift+Enter换行
           关键属性说明：
           - ref="textarea"：获取DOM元素用于手动调整高度
           - v-model="inputText"：双向绑定输入框内容到inputText变量
           - :placeholder="placeholder"：动态绑定占位提示文字
           - @input="resize"：输入内容变化时触发resize方法，实现输入框高度自适应
           - @keydown.enter.prevent：阻止回车默认换行行为，触发handleEnter方法（回车提交逻辑）
           渲染逻辑：始终渲染，内容为空时显示占位符，输入内容实时同步到inputText
      -->
      <textarea
        ref="textarea"
        v-model="inputText"
        class="inputbox"
        :placeholder="placeholder"
        @input="resize"
        @keydown.enter.prevent="handleEnter"
      ></textarea>

      <!-- 附件列表组件（带动画）：
           核心功能：展示已上传的文件列表，支持删除单个附件，增删时带淡入淡出动画
           关键属性说明：
           - transition-group：列表动画容器，name="fade"指定动画类名前缀，tag="div"渲染为div标签
           - v-if="attachments.length"：仅当attachments数组有数据时才渲染该列表（避免空列表占位）
           - v-for="file in attachments"：遍历attachments数组生成每个附件项，:key="file.id"保证列表渲染稳定性
           渲染逻辑：
           1. 先判断attachments是否有数据，无数据则不渲染整个列表容器
           2. 有数据时，遍历数组为每个文件生成一个attachment-chip项
           3. 每个项展示文件图标、名称、大小，点击删除按钮触发removeAttachment删除对应文件
           4. 增删文件时，通过transition-group添加fade动画效果
      -->
      <transition-group name="fade" tag="div" class="attachments" v-if="attachments.length">
        <div v-for="file in attachments" :key="file.id" class="attachment-chip">
          <el-icon class="attachment-icon"><Paperclip /></el-icon>
          <div class="attachment-meta">
            <span class="attachment-name">{{ file.name }}</span>
            <span class="attachment-size">{{ formatSize(file.size) }}</span>
          </div>
          <button class="attachment-remove" type="button" @click="removeAttachment(file.id)">
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </transition-group>

      <!-- 语音预览组件：
           核心功能：展示语音识别的实时文字结果
           关键属性说明：
           - v-if="speechPreview"：仅当speechPreview有内容时渲染（语音输入时显示）
           渲染逻辑：语音输入开启后，识别的文字实时更新到speechPreview，该组件自动显示；停止语音后若清空speechPreview则隐藏
      -->
      <div v-if="speechPreview" class="speech-preview">
        <el-icon><Microphone /></el-icon>
        <span>{{ speechPreview }}</span>
      </div>

      <!-- 工具栏组件：
           核心功能：提供文件上传、语音输入的操作按钮，以及使用提示
           关键属性说明：
           - v-if="isSpeechSupported"：仅当浏览器支持语音输入时显示语音按钮
           - :class="{ recording: isRecording }"：根据是否正在录音动态添加recording样式类
           - :disabled="isTyping"：当正在生成内容（isTyping=true）时禁用语音按钮
           渲染逻辑：
           1. 始终显示上传文件按钮，点击触发triggerFilePicker打开文件选择框
           2. 语音按钮仅在浏览器支持语音输入时显示，按钮文字根据isRecording动态切换（语音输入/停止语音）
           3. 始终显示Shift + Enter换行的提示文字
      -->
      <div class="toolbar">
        <button class="toolbar-btn" type="button" @click="triggerFilePicker">
          <el-icon><UploadFilled /></el-icon>
          <span>上传文件</span>
        </button>

        <!-- 前面是类名 -->
        <button
          v-if="isSpeechSupported"
          class="toolbar-btn"
          :class="{ recording: isRecording }"
          type="button"
          @click="toggleRecording"
          :disabled="isTyping"
        >
          <el-icon><Microphone /></el-icon>
          <span>{{ isRecording ? "停止语音" : "语音输入" }}</span>
        </button>
        <span class="toolbar-hint">Shift + Enter 换行</span>
      </div>
    </div>


    <!-- 操作按钮区域：
         核心功能：根据状态切换发送/停止按钮，控制内容提交和生成停止
         关键属性说明：
         - v-if="!isTyping"：未生成内容时显示发送按钮；v-else显示停止按钮
         - :disabled="sendDisabled"：当sendDisabled为true时禁用发送按钮（如内容为空）
         渲染逻辑：
         1. 初始状态（isTyping=false）：显示发送按钮，点击触发handleSubmit提交输入内容和附件
         2. 生成内容中（isTyping=true）：切换为停止按钮，点击触发stopGeneration停止内容生成
         3. 发送按钮是否可用由sendDisabled控制（通常判断输入内容/附件是否为空）
    -->
    <div class="action-area">
      <button
        v-if="!isTyping"
        class="send-button"
        type="button"
        :disabled="sendDisabled"
        @click="handleSubmit"
      >
        <span>发送</span>
        <el-icon><Promotion /></el-icon>
      </button>
      <button v-else class="stop-button" type="button" @click="stopGeneration">
        停止
        <el-icon class="stop-icon"><CircleClose /></el-icon>
      </button>
    </div>

    <!-- 隐藏的文件选择输入框：
         核心功能：提供原生文件选择能力，用于上传文件（被工具栏的上传按钮触发）
         关键属性说明：
         - ref="fileInput"：获取DOM元素用于手动触发点击
         - class="file-input"：通过样式隐藏该原生输入框
         - multiple：允许选择多个文件
         - :accept="acceptAttribute"：动态指定允许上传的文件类型
         - @change="handleFileChange"：选择文件后触发处理逻辑，将文件添加到attachments
         渲染逻辑：始终渲染但通过样式隐藏，仅通过triggerFilePicker方法触发其点击事件，实现自定义上传按钮的效果
    -->
    <!-- 这个是文件选择框， -->
    <input
      ref="fileInput"
      class="file-input"
      type="file"
      multiple
      :accept="acceptAttribute"
      @change="handleFileChange"
    />
  </div>
</template>


<style scoped>
.container {
  display: flex;
  gap: 16px;
  /* 靠下对齐 */
  align-items: flex-end;
  justify-content: space-between;
  padding: 16px 24px;
  background: var(--color-panel);
  border-top: 1px solid var(--color-border);
  backdrop-filter: blur(6px);
}

.input-area {
  /* 占满父容器剩余空间 */
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inputbox {
  width: 100%;
  min-height: 120px;
  max-height: 240px;
  font-size: 15px;
  line-height: 1.6;
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid var(--color-border);
  background: var(--color-input-background);
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
  /* 右下角文本框扩大缩小 */
  resize: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  /* 选中的输入框自动高亮取消 */
  outline: none;
}

.inputbox:focus {
  border-color: var(--color-accent);
  box-shadow: 0 4px 18px rgba(59, 130, 246, 0.18);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  /* flex-wrap: wrap：子元素超出容器宽度 / 高度时，自动换行，默认是不换行，子元素会被挤压 */
  flex-wrap: wrap;
}

.toolbar-btn {
  /* display: inline-flex = 行内 Flex 容器，对内和flex布局一致，对外他是有多宽占多宽，
  不会沾满一整行，是行内块
  这里是防御性编程，因为父组件约束，可以写flex布局，假如复制这个组件到别处不一定有约束了
  */
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 12px;
  border: none;
  background: var(--color-toolbar-bg);
  color: var(--color-toolbar-text);
  font-size: 13px;
  /* 鼠标悬停变成手 */
  cursor: pointer;
  transition: all 0.2s ease;
}

.toolbar-btn:hover {
  background: var(--color-toolbar-hover-bg);
  color: var(--color-accent-strong);
}

/* 两个类名权重更高，因此重复属性覆盖前面的 */
.toolbar-btn.recording {
  background: var(--color-stop-button-bg);
  color: var(--color-stop-button-text);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-toolbar-muted);
}

.attachments {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--color-toolbar-bg);
  color: var(--color-text-secondary);
  border: 1px solid rgba(59, 130, 246, 0.18);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.attachment-icon {
  font-size: 14px;
}

.attachment-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.attachment-name {
  font-size: 13px;
  font-weight: 500;
}

.attachment-size {
  font-size: 11px;
  color: var(--color-muted);
}

/* 这里行内块完全是为了让x居中 */
.attachment-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-muted);
  transition: color 0.2s ease;
}

.attachment-remove:hover {
  color: var(--color-danger);
}

.speech-preview {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--color-toolbar-bg);
  border: 1px solid rgba(59, 130, 246, 0.18);
}

.action-area {
  display: flex;
  align-items: center;
}

.send-button,
.stop-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
  height: 48px;
  border-radius: 16px;
  border: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.send-button {
  background: linear-gradient(135deg, var(--color-accent-strong), var(--color-accent));
  color: var(--color-accent-contrast);
  box-shadow: 0 8px 16px rgba(59, 130, 246, 0.28);
}

.send-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  box-shadow: none;
}

.send-button:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 20px rgba(59, 130, 246, 0.36);
}

.stop-button {
  background: var(--color-stop-button-bg);
  color: var(--color-stop-button-text);
  box-shadow: 0 6px 12px var(--color-stop-button-shadow);
}

.stop-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px var(--color-stop-button-shadow);
}

.stop-icon {
  font-size: 16px;
}

.file-input {
  display: none;
}

/* 进入动画的全过程 & 离开动画的全过程 */
/* 在这里统一设置过渡效果：透明度 0.2秒 平滑过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

/* 进入动画的开始状态 / 离开动画的结束状态 */
/* 透明度为 0（完全透明） */
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* align-items: stretch;交叉轴拉伸撑满父容器 */
@media (max-width: 960px) {
  .container {
    flex-direction: column;
    align-items: stretch;
  }

  .action-area {
    justify-content: flex-end;
  }
}

@media (max-width: 768px) {
  .container {
    padding: 16px 18px;
    gap: 12px;
  }

  .toolbar {
    gap: 10px;
  }

  .toolbar-hint {
    margin-left: 0;
    width: 100%;
    text-align: right;
  }

  .action-area {
    width: 100%;
  }

  .send-button,
  .stop-button {
    width: 100%;
    justify-content: center;
  }
}

@media (max-width: 480px) {
  .container {
    padding: 14px 14px;
  }

  .toolbar-btn span {
    display: none;
  }

  .toolbar-hint {
    font-size: 11px;
  }
}
</style>
