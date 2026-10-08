<!-- 这个组件是整个聊天应用的核心视图
它负责渲染完整的对话窗口，集成了 Markdown 解析、代码高亮、虚拟列表滚动优化、AI 推理过程展示、
以及与后端大模型的流式交互逻辑。 -->

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
  watchEffect,
} from "vue";
// 导入 highlight.js 的 GitHub 风格样式：让代码高亮显示为 GitHub 主题样式
import "highlight.js/styles/github.css";

import {
  CopyDocument,
  EditPen,
  Close,
  Delete,
  RefreshRight,
  DocumentCopy,
} from "@element-plus/icons-vue";

//  引入的两个组件，不是自己写的
import { DynamicScroller, DynamicScrollerItem } from "vue-virtual-scroller";

import { chatStream } from "@/apis/deepseek";
import AttachmentPreview from "@/components/chat/AttachmentPreview.vue";
import ChatInput from "@/components/chat/ChatInput.vue";
import { useSessionStore } from "@/stores/session";
import { createMessageMarkdownCache } from "@/utils/markdownRenderer";
import assistantAvatar from "@/assets/avatars/assistant.svg";
import userAvatar from "@/assets/avatars/user.svg";

defineOptions({ name: "ChatMessage" });

const sessionStore = useSessionStore();

// msg: 绑定底部输入框的文本
const msg = ref("");

// isTyping: 标识当前大模型是否正在疯狂输出中
const isTyping = ref(false);

// showNewMessageIndicator: 控制右下角“新消息”悬浮气泡的显示与隐藏
const showNewMessageIndicator = ref(false);

/**模型选择*/
const selectedModel = computed({
  get: () => sessionStore.model,
  set: (value) => sessionStore.setModel(value),
});

// 获取所有可用的模型列表（如下拉框的选项）
const modelOptions = computed(() => sessionStore.modelOptions);

// 判断当前选中的是不是带有“思考过程”的推理模型（如 deepseek-reasoner）
const shouldUseReasoner = computed(
  () => selectedModel.value === "deepseek-reasoner",
);

/**
 * 每次从sessionStore拿到当前对话，都给每一条消息发一个独一无二的“身份证号”(_key)。
 * 虚拟列表全靠这个 _key 来认路，防止画面上下抽搐。
 */
const messages = computed(() => {
  return sessionStore.getcurmsgs().map((msg, index) => ({
    ...msg,
    // 如果原数据没有 _key，强行用索引拼一个，保证虚拟列表绝对稳定
    _key: msg._key || msg.id || `msg_${index}`
  }));
});

/**
 * 【当前会话的思考过程数据】
 * 从 Store 中精准抽取当前正在聊的对话的思考链数组。?? [] 是防止报错的兜底机制。
 */
const reasoningList = computed(
  () => sessionStore.reason[sessionStore.curname] ?? [],
);

/**
 * 【思考过程的展开/收起状态】
 * 记录当前会话中，哪一条思考过程被用户点开了，哪一条收起了。
 */
const reasonVisibility = computed(
  () => sessionStore.showreason[sessionStore.curname] ?? [],
);

/**
 * 【监听切换对话事件】
 * 只要左侧侧边栏切换了当前对话（curname变了），立刻清场并把滚动条拉到最底下，给用户最佳阅读视角。
 */
watch(
  //如果不写回调函数，watch函数执行时先取到sessionStore.curname的值，只是一个值，
  () => sessionStore.curname,
  async () => {
    autoScroll = true;
    showNewMessageIndicator.value = false;
    //这里await意思是等forceScrollToBottom()内部执行完；
    await forceScrollToBottom();//自定义函数，强制回滚到最下面
  },
);

// 每条消息只保留最新 Markdown/HTML 对，内容未变化时直接复用 HTML。
const markdownCache = createMessageMarkdownCache();

watch(
  messages,
  (currentMessages) => {
    markdownCache.prune(currentMessages.map((item) => item._key));
  },
  { immediate: true },
);

// 引用虚拟列表的 DOM 实例
const scrollerRef = ref(null);

// 封装一个函数：随时获取虚拟列表的底层真实 DOM用于操作滚动条，第三方的dom标签获取加$el
const getChatContainer = () => scrollerRef.value?.$el;

/**
 * 【强制滚动到底部】
 * 无论当前在哪，不管三七二十一，直接把屏幕拉到最下面。通常用于刚进页面或切换对话时。
 */
const forceScrollToBottom = async () => {
  await nextTick();
  // 等待200ms，确保 DOM 已经完全画好
  await new Promise((resolve) => setTimeout(resolve, 200));
  const container = getChatContainer();
  if (container) {
    //scrollTop卷上去的高度=scrollHeight内容的高度说明到底了，浏览器自动兜底，不会真的都卷走，
    container.scrollTop = container.scrollHeight;
    // 再做一个平滑滚动的兜底，让体验更好
    setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
  }
};

// 全局开关：当前是否允许自动跟随新消息往下滚
let autoScroll = true;

// 👇 终极修复 2：准备一把“物理锁”，用来实时记录并锁死用户的阅读位置
const lockedScrollTop = ref(null);

/**
 * 【常规跟随滚动】
 * 只有在 autoScroll 为 true（用户没有往上滑）的时候，才执行滚动到底部的操作。
 */
const scrollToBottom = async () => {
  if (!autoScroll) return;
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  // 100ms 后再次确认，防止在这 100ms 内用户突然往上滑了
  if (!autoScroll) return;

  const container = getChatContainer();
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
};

/**
 * 【点击“新消息”气泡时的动作】
 * 解开各种锁，隐藏气泡，并欢快地滚到底部。
 */
const scrollToBottomOnClick = async () => {
  autoScroll = true;
  lockedScrollTop.value = null; //无需锁死
  showNewMessageIndicator.value = false;
  await scrollToBottom();
};

/**
 * 用户发生交互
 * 模型正在输入，显示新消息提示按钮。
 */
const handleUserInteraction = () => {
  autoScroll = false;
  if (isTyping.value) {
    showNewMessageIndicator.value = true;
  }
};

/**
 * 滚动条事件监听（极其关键）
 * 实时判断用户是滚到了最下面，还是在往上翻阅旧历史。
 */
const handleScroll = (e) => {
  const container = e ? e.target : getChatContainer();
  if (!container) return;

  //卷去的高度，总内容高度，可视区高度
  const { scrollTop, scrollHeight, clientHeight } = container;
  // 计算当前视口距离最底部的像素距离
  const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

  // 只要距离底部小于 40px，就认为用户在底部，恢复自动跟随
  if (distanceToBottom <= 40) {
    autoScroll = true;
    lockedScrollTop.value = null; // 回到底部，解锁
    showNewMessageIndicator.value = false;
  } else {
    // 距离超过 40px，判定为用户在向上阅读！立刻打断自动滚动！
    autoScroll = false;
    // 💡 核心：当用户主动滚动时，实时更新物理锁的位置
    lockedScrollTop.value = scrollTop;
    if (isTyping.value) {
      // 只要大模型还在输出，就弹出“新消息”提醒
      showNewMessageIndicator.value = true;
    }
  }
};

// pendingDeltas: 用来收集大模型高速吐出来的碎字
const pendingDeltas = ref("");
// bufferTimer: 缓冲定时器
let bufferTimer = null;

/**
 * 清空缓冲池
 * 把积攒在 pendingDeltas 里的字一次性交给大管家，然后清空池子。
 */
const flushBuffer = () => {
  if (!pendingDeltas.value) return;
  sessionStore.adddelta(pendingDeltas.value); // 往正文追加内容
  pendingDeltas.value = "";

  // 如果处于跟随状态，推完字立刻滚一下
  if (autoScroll) {
    scrollToBottom();
  }
};

/**
 * 【接收流式正文的回调】
 * 大模型每吐出一个字，就会触发一次这个函数。我们用定时器做个 200ms 的防抖，攒一波字再更新页面，保护性能。
 */
const onDelta = (delta) => {
  pendingDeltas.value += delta;
  if (!bufferTimer) {
    bufferTimer = setTimeout(() => {
      flushBuffer();
      bufferTimer = null;
    }, 200);
  }
};

/**
 * 【接收推理过程（思考链）的回调】
 * 推理过程不用防抖（也就是缓冲），因为没表格，高亮，一些渲染，比较简单，直接追加，并触发滚动。
 */
const handleReasoningDelta = (delta) => {
  if (!shouldUseReasoner.value) return;
  sessionStore.add(delta); // 往思考链追加内容
  if (autoScroll) {
    scrollToBottom();
  }
};

/**
 * 【流式请求结束时的收尾工作】
 */
const handleStreamFinished = () => {
  isTyping.value = false;
  flushBuffer(); // 把最后剩下的一点点字吐出来
  showNewMessageIndicator.value = false;
};

// 只要大模型停止打字了，立刻强制清空缓存池，确保字不被吞掉
watchEffect(() => {
  if (!isTyping.value) {
    flushBuffer();
  }
});

// 监听虚拟列表的高频重绘
let resizeObserver = null;

/**
 * 【组件挂载完毕】
 */
onMounted(async () => {
  addCopyButtons(); // 扫描一次代码块加按钮
  await forceScrollToBottom();

  const container = getChatContainer();
  if (container) {
    // 创建一个观察者：专门盯着虚拟列表的高度变化（防画面蠕动的终极绝招）
    resizeObserver = new ResizeObserver(() => {
      // 只要虚拟列表的高度发生了任何改变，且用户当前处于“向上翻阅的锁定阅读”状态...
      if (!autoScroll && lockedScrollTop.value !== null) {
        // 🚨 绝对暴力：不管浏览器怎么因为新加的文字而擅自移动滚动条，我们瞬间把它摁回锁定的精确像素！
        container.scrollTop = lockedScrollTop.value;
      }
    });

    // 观察虚拟列表内部真正包裹所有消息、高度不断变化的那个核心层
    const wrapper = container.querySelector('.vue-recycle-scroller__item-wrapper') || container;
    resizeObserver.observe(wrapper);
  }
});

/**
 * 【组件更新时】
 * 页面有变化时，再去扫一圈看看有没有新的代码块需要加复制按钮。
 *
 *
 * 重要：这里的问题深究,首先ai吐出的文字有可能高亮，加粗，表格什么都有，不能提前在<template>标签里描述好结构，
 * 因此用解析工具比如markdown解析为 HTML 代码字符串
 * 最后v-html把字符串直接给页面里，浏览器自己渲染，我们自己管不到他，里面的样式，逻辑都管不到
 * 因此如果想修改的或者操作他：第一把狙击枪：CSS 穿透（:deep()），第二把狙击枪：原生 JS（onUpdated）
 * 也就是这里JS（onUpdated）虽然管不到死的标签，但是比如addCopyButtons函数，里面的逻辑会拿到vue解析不了的dom标签，
 * 在内部强行给这个元素添加事件
 */
onUpdated(() => {
  addCopyButtons();
});

/**
 * 【组件销毁前】
 * 打扫战场，清理定时器、把剩余的字推出去、断开高度观察者，防止内存泄漏。
 */
onBeforeUnmount(() => {
  clearTimeout(bufferTimer);
  flushBuffer();
  markdownCache.clear();
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
});

/**
 * 【发送消息给大模型的主函数】
 *  从传入的实参里面结构出attachments，如果没有attachments默认为空数组
 *  msg底部输入框
 */
const submit = async ({ attachments = [] } = {}) => {
  const trimmed = msg.value.trim();
  // 没写字也没发附件就拦截
  if (!trimmed && !attachments.length) return;

  // --- 第一步：处理用户消息 ---
  // sessionpush 内部现在会自动处理 reason[""] 和 showreason[false]
  sessionStore.sessionpush({
    role: "user",
    content: trimmed,
    attachments,
  });

  // --- 第二步：清理现场 ---
  msg.value = "";
  await scrollToBottom();

  // --- 第三步：处理 AI 占位消息 ---
  // 这里调用 sessionpush 时，内部由于 role 是 assistant，
  // 会自动执行 showreason.push(true)，从而实现默认展开！
  const aiMessage = { role: "assistant", content: "", attachments: [] };
  sessionStore.sessionpush(aiMessage);// 这里把空的ai回复添加进session完全是为了渲染页面，

  isTyping.value = true;
  autoScroll = true;

  try {
    // Store 会排除页面使用的空 AI 占位，并按 Token 预算选择最近的完整轮次。
    const payloadMessages = sessionStore.getMessagesForModel();

    // --- 第四步：正式发起流式请求 ---
    await chatStream(
      payloadMessages,
      onDelta,                 // 处理正文更新
      handleStreamFinished,    // 处理结束
      handleReasoningDelta,    // 处理思考过程更新
      selectedModel.value,
    );
  } catch (error) {
    isTyping.value = false;
    sessionStore.adddelta("抱歉，回复生成出错");
    showNewMessageIndicator.value = false;
    flushBuffer();
    console.error(error);
  } finally {
    autoScroll = true;
  }
};

/**
 * 【渲染 Markdown】
 * 在模板中调用，把纯文本丢给 md 渲染器转成 HTML
 */
const renderMarkdown = (messageId, raw) =>
  markdownCache.render(messageId, raw);


/**
 * 【硬核 DOM 操作：给代码块添加复制按钮】
 */
const addCopyButtons = () => {
  nextTick(() => {
    const container = getChatContainer();
    if (!container) return;

    // 找到所有 Markdown 渲染出来的 <pre> 标签（代码块外层包裹元素）
    const codeBlocks = container.querySelectorAll("pre");
    codeBlocks.forEach((block) => {
      // 如果已经加过了就不加了
      if (block.querySelector(".copy-btn")) return;

      // 创建一个原生按钮节点，
      const button = document.createElement("button");
      button.className = "copy-btn";
      button.innerHTML = "复制";

      // 绑定点击事件，调用浏览器剪贴板 API 复制里面的代码文字
      // 给按钮绑定点击事件
      button.addEventListener("click", () => {
        // 获取代码块里的文本内容：找不到code元素就返回空字符串，防止报错
        const code = block.querySelector("code")?.textContent ?? "";

        // 调用浏览器剪贴板API，把代码文本复制到剪贴板
        navigator.clipboard.writeText(code).then(() => {
          // 复制成功后，按钮文字临时改成“ok了”
          button.textContent = "ok了";

          // 设置定时器：2秒后把按钮文字恢复成“复制”
          setTimeout(() => {
            button.textContent = "复制";
          }, 2000);
        });
      });
      // 把按钮塞进 <pre> 标签里
      block.appendChild(button);
    });
  });
};

/**
 * 【复制纯文本功能】
 */
const copyMessage = (text) => {
  navigator.clipboard.writeText((text ?? "").trim());
};

/**
 * 【复制 Markdown 全文功能】
 */
const copyMessageMarkdown = (text) => {
  navigator.clipboard.writeText(text ?? "");
};

/**
 * 【删除某一条特定的聊天记录】
 */
const handleDeleteMessage = (index) => {
  sessionStore.removeMessageAt(index);
};

/**
 * 【重新生成某条消息】
 * 逻辑和 submit 基本一致，只是会先“切掉”这条消息和它之后的所有消息，然后再重新发起请求。
 */
const handleRegenerateMessage = async (index) => {
  const target = messages.value[index];

  // 1. 安全校验：只有 AI 的消息能重生成，且正在打字时不允许操作
  if (!target || target.role !== "assistant" || isTyping.value) {
    return;
  }

  // 2. 环境清理：从当前点击的这个 AI 消息索引开始，把后面所有的消息全部切掉
  // 此时 sessionStore.trimMessagesFrom(index) 会同步清理 session、reason 和 showreason 数组
  sessionStore.trimMessagesFrom(index);

  // 因为接下来的 sessionpush 会自动为新的 assistant 消息创建对齐的 reason 坑位
  // 并且会自动将 showreason 设置为 true。

  // 3. 构建占位：建好 AI 的新消息空壳
  const aiMessage = { role: "assistant", content: "", attachments: [] };

  // 调用改造后的 sessionpush，它会一站式处理：
  // - session[index] = { role: 'assistant', content: '' }
  // - reason[index] = ""
  // - showreason[index] = true (因为是 assistant)
  sessionStore.sessionpush(aiMessage);

  isTyping.value = true;
  autoScroll = true;

  try {
    // 4. 准备发送给大模型的预算内上下文数据
    const payloadMessages = sessionStore.getMessagesForModel();

    // 5. 开启流式传输
    await chatStream(
      payloadMessages,
      onDelta,                 // 处理 AI 正文
      handleStreamFinished,    // 传输结束回调
      handleReasoningDelta,    // 处理 AI 思考过程
      selectedModel.value,     // 当前选中的模型
    );
  } catch (error) {
    // 异常处理
    isTyping.value = false;
    sessionStore.adddelta("抱歉，回复生成出错");
    showNewMessageIndicator.value = false;
    flushBuffer();
    console.error("重生成失败:", error);
  } finally {
    autoScroll = true;
  }
};

/**
 * 【根据角色分配头像】
 */
const avatarForRole = (role) => (role === "user" ? userAvatar : assistantAvatar);

// 控制顶部标题是否处于编辑状态
const isEditingTitle = ref(false);
const tempTitle = ref("");

/**
 * 【开启编辑标题】
 *  这个是点击之后做的事，
 */
const startEditing = () => {
  tempTitle.value = sessionStore.curname;
  isEditingTitle.value = true;
  // 等待输入框渲染出来后，自动让它获得焦点光标
  nextTick(() => {
    document.querySelector(".title-input input")?.focus();
  });
};

/**
 * 【保存修改后的标题】
 */
const saveTitle = () => {
  if (tempTitle.value.trim()) {
    sessionStore.updateTitle(tempTitle.value.trim());
  }
  isEditingTitle.value = false;
};

/**
 * 【取消标题修改】
 */
const cancelEditing = () => {
  isEditingTitle.value = false;
};

/**
 * 【切换某一条思考过程的展开/收起状态】
 */
const toggleReason = (index) => {
  sessionStore.qiehuan(index);
};

/**
 * 【获取某一条消息的思考过程内容】
 */
const reasoningText = (index) => reasoningList.value[index] ?? "";

/**
 * 【判断思考过程区块是否应该显示在屏幕上】
 * 条件：里面有文字，并且在大管家那里记录的状态是 true（已展开）。
 */
const shouldDisplayReason = (index) => {
  const text = reasoningText(index);
  return text.trim() && (reasonVisibility.value[index] ?? false);
};

/**
 * 【外部通信：切换历史会话】
 * （通常是被左侧侧边栏组件调用）清空积压缓冲并让大管家切换数据。
 */
const selecthistory = (name) => {
  flushBuffer();
  sessionStore.selecthistory(name);
};

// 暴露出去，让父组件（主界面）能通过模板 ref (.callR之类) 调用这个函数
//先获取子组件实例对象在.selecthistory获取到这个方法
defineExpose({ selecthistory });
</script>
<!--  @keyup.enter="saveTitle"  点击回车触发保存函数
      @blur="saveTitle"点击别处，触发保存函数
      :teleported="false" 因为下拉菜单比较小，不会超过父盒子，因此false
 -->
<template>
  <div class="header">
    <div class="header-title">
      <template v-if="!isEditingTitle">
        {{ sessionStore.curname }}
        <el-icon @click="startEditing"><EditPen /></el-icon>
      </template>
      <template v-else>
        <el-input
          v-model="tempTitle"
          class="title-input"
          size="small"
          @keyup.enter="saveTitle"
          @blur="saveTitle"
        />
        <el-icon @mousedown.prevent="cancelEditing"><Close /></el-icon>
      </template>
    </div>
    <el-select
      v-model="selectedModel"
      size="small"
      class="model-select"
      :disabled="isTyping"
      placeholder="选择模型"
      :teleported="false"
    >
      <el-option
        v-for="option in modelOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
  </div>

<!-- :min-item-size="120"最小预估高度

    容器发生滚动时（滚动条拖动/滚轮滑动）触发
    @scroll="handleScroll"

    鼠标滚轮滚动时触发
    @wheel="handleUserInteraction"

    手机端触摸屏幕开始时触发（手指按下）
    @touchstart="handleUserInteraction"

    鼠标按下时触发（左键/右键/中键都算）
    @mousedown="handleUserInteraction"

    <键盘任意按键按下时触发
    @keydown="handleUserInteraction"
    -->
    <DynamicScroller
    class="content"
    ref="scrollerRef"
    :items="messages"
    :min-item-size="120"
    key-field="_key"
    :key="sessionStore.curname"
    @scroll="handleScroll"
    @wheel="handleUserInteraction"
    @touchstart="handleUserInteraction"
    @mousedown="handleUserInteraction"
    @keydown="handleUserInteraction"
  >
    <!--接受子组件，内容，索引，是否在页面内，不在页面内为false隐藏气泡
    这三项是DynamicScroller组件内部算出的，不经你手
    size-dependencies监视数组里的内容变化调整气泡高度
    shouldDisplayReason(index)这个函数于高度绑定，假如变成展开，高度增加了，但是前两项都没变你还没监视开关，
    这样就不会增加气泡高度 -->
    <template #default="{ item, index, active }">
      <DynamicScrollerItem
        :item="item"
        :active="active"
        :data-index="index"
        :size-dependencies="[item.content, reasoningText(index), shouldDisplayReason(index)]"
      >

        <div
          class="message-row"
          :class="item.role === 'user' ? 'is-user' : 'is-assistant'"
        >
          <img
            class="message-avatar"
            :src="avatarForRole(item.role)"
            :alt="item.role === 'user' ? '用户头像' : 'AI头像'"
          />
          <div
            class="message"
            :class="item.role === 'user' ? 'user-message' : 'assistant-message'"
          >
            <div class="message-header">
              <span class="message-role">{{ item.role === 'user' ? '大帅哥' : '人工智障' }}</span>
              <div class="message-actions">
                <!-- 这个是悬停button的气泡组件，纯文本在正上方启动 -->
                <el-tooltip content="复制纯文本" placement="top">
                  <button @click="copyMessage(item.content)" class="action-btn">
                    <el-icon><CopyDocument /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip
                  v-if="item.role === 'assistant'"
                  content="复制全文"
                  placement="top"
                >
                  <button
                    @click="copyMessageMarkdown(item.content)"
                    class="action-btn"
                  >
                    <el-icon><DocumentCopy /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip
                  v-if="item.role === 'assistant'"
                  content="重新回复"
                  placement="top"
                >
                  <button @click="handleRegenerateMessage(index)" class="action-btn">
                    <el-icon><RefreshRight /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip content="删除此消息" placement="top">
                  <button @click="handleDeleteMessage(index)" class="action-btn">
                    <el-icon><Delete /></el-icon>
                  </button>
                </el-tooltip>
              </div>
            </div>

            <div v-if="reasoningText(index).trim()" class="reasoning-header">
              <span>思考过程</span>
              <button class="reason-toggle" @click="toggleReason(index)">
                {{ shouldDisplayReason(index) ? '收起' : '展开' }}
              </button>
            </div>

            <div v-if="shouldDisplayReason(index)" class="reasoning-body">
              {{ reasoningText(index) }}
            </div>

            <div
              class="message-body"
              v-html="renderMarkdown(item._key, item.content)"
            ></div>

            <AttachmentPreview
              v-if="item.attachments?.length"
              :attachments="item.attachments"
            />
          </div>
        </div>
      </DynamicScrollerItem>
    </template>
  </DynamicScroller>

  <!--ChatInput组件应用，支持与父组件双向绑定，对接组件内部的 msg 属性，用 "msg" 接受 -->
  <ChatInput v-model:msg="msg" v-model:isTyping="isTyping" @submit="submit" />

  <!-- 新消息指示器 -->
  <div
    v-if="showNewMessageIndicator"
    class="new-message-indicator"
    @click="scrollToBottomOnClick"
  >
    新消息
  </div>
</template>


<style scoped>
.header {
  padding: 18px 24px;
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-heading);
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-title {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.model-select {
  width: 220px;
}

.header .el-icon {
  cursor: pointer;
  color: var(--color-muted);
  transition: color 0.2s ease;
}

.header .el-icon:hover {
  color: var(--color-heading);
}

.title-input {
  width: 220px;
  max-width: 60%;
}

/* 1. 给中间的聊天列表本身加上霸座属性和滚动条 */
.content {
  flex: 1; /* 霸座狂魔上线！把输入框挤到底部 */
  overflow-y: auto;/* 当内容超出容器高度时，自动显示垂直滚动条；没超出就不显示。 */
  background: var(--color-panel-alt);
  padding: 32px 12%;
  /* 内容抖动 */
  overflow-anchor: none !important;
}

/* 2. 单独给里面的子元素关闭滚动锚定 */
.content * {
  overflow-anchor: none !important;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 24px;
}

.message-row.is-user {
  /* 正常从左到右，这里反过来 */
  flex-direction: row-reverse;
}

.message-avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--color-surface);
  padding: 6px;
  box-shadow: var(--shadow-soft);
}

.message {
  max-width: 70%;
  width: fit-content;
  padding: 16px 20px;
  border-radius: 18px;
  position: relative;
  box-shadow: var(--shadow-soft);
  animation: fadeIn 0.3s ease;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  /* 换行 */
  word-break: break-word;
  color: var(--color-text-primary);
}

.message.user-message {
  background: var(--color-bubble-user);
  color: var(--color-accent-contrast);
  border:px solid var(--color-bubble-user-border);
}

.message.assistant-message {
  background: var(--color-elevated-surface);
  color: var(--color-text-primary);
}

.message-row.is-user .message-actions .action-btn {
  color: rgba(249, 250, 251, 0.8);
}

.message-row.is-user .message-actions .action-btn:hover {
  color: var(--color-accent-contrast);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.message-role {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: inherit;
}

.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.action-btn:hover {
  background: var(--color-reasoning-surface);
  color: var(--color-text-primary);
}

.message-row.is-user .action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.reasoning-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--color-reasoning-surface);
  color: inherit;
  font-size: 13px;
  margin-bottom: 8px;
}

.reason-toggle {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.reason-toggle:hover {
  /* 下划线 */
  text-decoration: underline;
}

.reasoning-body {
  padding: 12px;
  border-radius: 10px;
  background: var(--color-reasoning-contrast);
  border: 1px solid var(--color-reasoning-border);
  margin-bottom: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: inherit;
}

.message.user-message .reasoning-header,
.message.user-message .reasoning-body {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.22);
}

/* ========== 消息内容区域样式 ========== */
/* 普通段落样式，穿透子组件样式限制 */
.message-body :deep(p) {
  margin: 0.5em 0; /* 上下间距 0.5em，让段落不挤在一起 */
}

/* 消息内普通链接文字颜色 */
.message-body :deep(a) {
  color: var(--color-link); /* 使用全局定义的链接主色 */
}

/* 鼠标悬浮在链接上时的样式 */
.message-body :deep(a:hover) {
  text-decoration: underline; /* 显示下划线 */
  color: var(--color-link-hover); /* 切换为悬浮态颜色 */
}

/* 行内代码块（非高亮代码）样式 */
.message-body :deep(code:not(.hljs)) {
  background: var(--color-code-surface); /* 背景色 */
  padding: 0.2em 0.4em; /* 内边距，让文字不贴边 */
  border-radius: 4px; /* 圆角，更美观 */
}

/* ========== 代码块区域样式 ========== */
/* 预格式化代码块（整块代码）容器，防御性编程，假如大模型的思考过程不是{{}}这样而是和v-html形式，就不用改别的了
 */
.content :deep(pre) {
  position: relative; /* 相对定位，用于容纳复制按钮绝对定位 */
  background: var(--color-code-surface); /* 代码块背景色 */
  border: 1px solid var(--color-code-border); /* 边框 */
  border-radius: 10px; /* 大圆角，美观 */
  padding: 16px; /* 内边距 */
  margin: 16px 0; /* 上下外边距，和其他内容隔开 */
  overflow-x: auto; /* 内容过长时，横向出现滚动条 */
}

/* 高亮代码内容样式 */
.content :deep(code.hljs) {
  background: transparent; /* 透明背景，继承父容器背景 */
  padding: 0; /* 无内边距 */
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; /* 等宽字体，代码专用 */
  font-size: 14px; /* 代码字体大小 */
  color: var(--color-text-primary); /* 代码文字主色 */
}

/* 代码块顶部添加【代码】标签 */
.content :deep(pre)::before {
  content: "代码"; /* 显示文字：代码 */
  display: block; /* 独占一行 */
  font-size: 12px; /* 小字体 */
  color: var(--color-code-label); /* 标签文字颜色 */
  margin-bottom: 8px; /* 下方间距，和代码隔开 */
}

/* 代码块复制按钮样式 */
.content :deep(.copy-btn) {
  position: absolute; /* 绝对定位，固定在代码块右上角 */
  top: 10px; /* 距离顶部 10px */
  right: 10px; /* 距离右侧 10px */
  padding: 4px 10px; /* 按钮内边距 */
  border-radius: 6px; /* 按钮圆角 */
  background: var(--color-copy-button-bg); /* 按钮背景色 */
  color: var(--color-accent-contrast); /* 按钮文字颜色 */
  border: none; /* 无边框 */
  cursor: pointer; /* 鼠标悬浮变成小手 */
  font-size: 12px; /* 按钮文字大小 */
}

/* 复制按钮悬浮样式 */
.content :deep(.copy-btn:hover) {
  background: var(--color-copy-button-hover); /* 悬浮时背景变色 */
}

.new-message-indicator {
  /* 子绝父相，子参看父亲，子固定就参看浏览器视口 */
  position: fixed;
  bottom: 80px;
  right: 24px;
  background: var(--color-new-indicator-bg);
  color: var(--color-accent-contrast);
  padding: 8px 18px;
  border-radius: 999px;
  z-index: 999;
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--shadow-strong);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.new-message-indicator:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-strong);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 我引入的两个组件，解析后就这个类名 */
.vue-recycle-scroller__item-view {
  margin: 0 !important;
}

.content :deep(table) {
  width: 100%;
  /* 合并相连的线变为一条线 */
  border-collapse: collapse;
  margin: 16px 0;
  background: var(--color-table-bg);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--color-table-border);
  font-size: 14px;
}

/* th表头，姓名；
   td表格，王刚 */
.content :deep(th),
.content :deep(td) {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-table-border);
}

.content :deep(th) {
  background: var(--color-table-header-bg);
  font-weight: 600;
  color: var(--color-heading);
}

/* 行，最后一行，里面的所有表格 */
.content :deep(tr:last-child td) {
  border-bottom: none;
}

/* ========== 自定义滚动条样式 ==========
Chrome/Safari/Edge）专用的 CSS 伪元素*/
/* 1. 滚动条整体容器 */
::-webkit-scrollbar {
  width: 6px; /* 纵向滚动条的宽度（横向滚动条用 height） */
}

/* 2. 滚动条轨道（背景槽） */
::-webkit-scrollbar-track {
  background: var(--color-scroll-track); /* 轨道背景色，使用全局CSS变量 */
  border-radius: 3px; /* 轨道圆角，更美观 */
}

/* 3. 滚动条滑块（可拖动的那个条） */
::-webkit-scrollbar-thumb {
  background: var(--color-scroll-thumb); /* 滑块颜色 */
  border-radius: 3px; /* 滑块圆角 */
}

/* 4. 鼠标悬浮在滑块上时的样式 */
::-webkit-scrollbar-thumb:hover {
  background: var(--color-scroll-thumb-hover); /* 悬浮时滑块变深，增强交互感 */
}

@media (max-width: 960px) {
  .content {
    padding: 24px 24px;
  }

  .message {
    max-width: 85%;
  }
}

@media (max-width: 640px) {
  .content {
    padding: 20px 16px;
  }

  .message-row {
    gap: 12px;
  }

  .message {
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 14px 18px;
    font-size: 16px;
  }

  .title-input {
    width: 180px;
  }

  .content {
    padding: 18px 12px;
  }

  .message-avatar {
    width: 36px;
    height: 36px;
    padding: 4px;
  }

  .message {
    padding: 14px 16px;
  }

  .message-actions {
    gap: 4px;
  }
}
</style>
