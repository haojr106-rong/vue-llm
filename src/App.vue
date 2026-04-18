<!-- 引入全局样式文件，作为组件基础样式 -->
<style src="@/assets/main.css"></style>

<script setup>
// 导入 Vue 核心组合式 API
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

// 导入子组件：chatMessage.vue组件包含（chatinput，attachmentpreview）
// 这两个分别是右侧，左侧
import ChatMessage from "@/views/chatMessage.vue";
import ConversationSidebar from "@/components/chat/ConversationSidebar.vue";

// 导入 Pinia Store：主题状态、会话状态
import { useThemeStore } from "@/stores/theme";
import { useSessionStore } from "@/stores/session";
// 导入 Element Plus 图标组件
import { Close, Menu } from "@element-plus/icons-vue";

/**
 * 保存右侧对话面板的组件引用，方便在侧边栏切换会话时
 * 调用内部暴露的方法来同步消息列表。
 */
const chatPanelRef = ref(null);
// 初始化主题状态管理实例
const themeStore = useThemeStore();
// 初始化会话状态管理实例
const sessionStore = useSessionStore();

// 定义移动端断点阈值（像素），用于响应式布局判断
const MOBILE_BREAKPOINT = 1024;

// 控制侧边栏是否展开（主要用于移动端）
const isSidebarOpen = ref(false);
// 标记当前设备是否为移动端（根据窗口宽度动态更新）
const isMobile = ref(false);

/**
 * 计算属性：获取当前会话的标题
 * 优先使用会话状态中的自定义名称，无则显示默认值 "DeepSeek 对话"
 * 计算属性会一直跟踪sessionStore.curname的值并实时更新currentConversationTitle
 */
const currentConversationTitle = computed(
  () => sessionStore.curname || "DeepSeek 对话",
);

/**
 * 组件卸载前的清理操作
 * 1. 执行主题 Store 的清理方法，释放相关资源
 * 2. 移除窗口大小变化的监听事件，避免内存泄漏
 */
onBeforeUnmount(() => {
  themeStore.cleanup();
  // 兼容服务端渲染场景，确保 window 对象存在时再移除监听
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", updateViewportMode);
  }
});

/**
 * 侧边栏会话选中事件的处理函数
 * @param {Object} conversation - 选中的会话对象
 * 1. 调用聊天面板组件的 selecthistory 方法，刷新对应会话的消息列表
 * 2. 移动端场景下，选中会话后自动关闭侧边栏，提升操作体验
 */
const handleHistorySelect = (conversation) => {
  // 使用可选链操作符避免组件未挂载时的报错
  chatPanelRef.value?.selecthistory(conversation);
  if (isMobile.value) {
    isSidebarOpen.value = false;
  }
};

/**
 * 更新视图模式（判断是否为移动端）
 * 1. 兼容服务端渲染，确保 window 对象存在
 * 2. 根据窗口宽度与断点阈值的对比，更新 isMobile 状态
 * 3. 非移动端时强制关闭侧边栏（恢复桌面端布局）
 */
const updateViewportMode = () => {
  if (typeof window === "undefined") return;
  isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT;
  //pc端取消侧边栏
  if (!isMobile.value) {
    isSidebarOpen.value = false;
  }
};

/**
 * 切换移动端侧边栏的展开/收起状态
 * 仅在移动端生效，桌面端不响应此操作
 */
const toggleSidebar = () => {
  if (!isMobile.value) return;
  isSidebarOpen.value = !isSidebarOpen.value;
};

/**
 * 关闭移动端侧边栏
 * 仅在移动端生效，用于点击遮罩层时关闭侧边栏
 */
const closeSidebar = () => {
  if (!isMobile.value) return;
  isSidebarOpen.value = false;
};

/**
 * 组件挂载完成后的初始化操作
 * 1. 立即执行一次视图模式检测，初始化 isMobile 状态
 * 2. 添加窗口大小变化监听，实现响应式布局（passive: true 提升滚动性能）
 */
onMounted(() => {
  updateViewportMode();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", updateViewportMode, { passive: true });
  }
});
</script>



<template>
  <!-- 应用外壳容器：通过 is-sidebar-open 类控制侧边栏展开状态 -->
  <div class="app-shell" :class="{ 'is-sidebar-open': isSidebarOpen }">
    <!-- 移动端头部：仅在小屏幕下显示，包含侧边栏切换按钮和当前会话标题
     这里没写 v-if 是通过媒体查询，决定是否展示 -->
    <header class="mobile-header">
      <button
        class="mobile-header__action"
        type="button"
        @click="toggleSidebar"
        aria-label="切换会话列表"
      >
        <el-icon>
          <!-- 动态切换图标：侧边栏展开时显示关闭图标，否则显示菜单图标 -->
          <component :is="isSidebarOpen ? Close : Menu" />
        </el-icon>
      </button>
      <!-- 会话标题：超出时显示省略号，title鼠标悬停出现的文字 -->
      <div class="mobile-header__title" :title="currentConversationTitle">
        {{ currentConversationTitle }}
      </div>
    </header>

    <!-- 主体内容容器：包含侧边栏和聊天面板 -->
    <div class="box">
      <!-- 左侧会话侧边栏：is-mobile-active 控制移动端是否显示 -->
      <div class="sideleft" :class="{ 'is-mobile-active': isSidebarOpen }">
        <!-- 会话侧边栏组件：监听 callR 事件（选中会话），触发 handleHistorySelect 处理 -->
        <ConversationSidebar @callR="handleHistorySelect" />
      </div>
      <!-- 右侧聊天面板：绑定 ref 用于调用组件内部方法 -->`
      <div class="sideright">
        <ChatMessage ref="chatPanelRef" />
      </div>
    </div>

    <!-- 移动端遮罩层：侧边栏展开时显示，点击遮罩关闭侧边栏 -->
    <div
      v-if="isMobile && isSidebarOpen"
      class="mobile-overlay"
      @click="closeSidebar"
    ></div>
  </div>
</template>

<style scoped>
/* 应用外壳：全屏高度，弹性布局，相对定位（为子元素绝对定位提供参考） */
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 主体容器：弹性布局，占满剩余高度和宽度，背景色使用主题变量 */
.box {
  display: flex;
  height: 100%;
  width: 100%;
  /*var()内置函数，去寻找值 */
  background: var(--color-app-background);
}

/* 移动端头部：默认隐藏，仅在小屏幕下显示 */
.mobile-header {
  display: none; /* 默认隐藏移动端头部（大屏不显示） */
  align-items: center; /* 子元素垂直居中对齐 */
  gap: 12px; /* 子元素之间的间距（水平/垂直） */
  padding: 12px 16px; /* 内边距：上下12px，左右16px */
  background: var(--color-panel); /* 背景色：使用自定义面板色变量 */
  border-bottom: 1px solid var(--color-border); /* 底部边框：1px 自定义边框色 */
  position: sticky; /* 粘性定位（实现吸顶核心） */
  top: 0; /* 吸顶锚点：距离顶部0px时固定 */
  z-index: 12; /* 层级：确保头部在侧边栏等元素上方显示 */
}

/* 移动端头部操作按钮：侧边栏切换按钮样式 */
.mobile-header__action {
  display: inline-flex; /* 行内flex布局：不独占一行，且子元素支持flex对齐 */
  align-items: center; /* 子元素（图标）垂直居中 */
  justify-content: center; /* 子元素（图标）水平居中 */
  width: 40px; /* 按钮宽度：固定40px */
  height: 40px; /* 按钮高度：固定40px（宽高一致成正方形） */
  border-radius: 12px; /* 圆角：让按钮边角圆润 */
  border: 1px solid var(--color-border); /* 边框：1px 自定义边框色 */
  background: var(--color-surface); /* 背景色：使用自定义表层色变量 */
  cursor: pointer; /* 鼠标悬停时显示手型（提示可点击） */
  color: var(--color-text-secondary); /* 文字/图标颜色：自定义次要文本色 */
  transition: background-color 0.2s ease, color 0.2s ease; /* 过渡动画：背景色/颜色变化时0.2秒缓动，提升交互体验 */
}

/* 操作按钮 hover 状态：背景和文字颜色变化 */
.mobile-header__action:hover {
  background: var(--color-toolbar-bg);
  color: var(--color-heading);
}

/* 移动端头部标题：超出显示省略号，单行显示 */
.mobile-header__title {
  flex: 1; /* flex占满剩余空间：在移动端头部中，挤开左右操作按钮，占满中间区域 */
  font-size: 16px; /* 字体大小：移动端标题常用16px，适配手机阅读 */
  font-weight: 600; /* 字体粗细：600为半粗体（比默认400粗，比700细），突出标题 */
  color: var(--color-heading); /* 文字颜色：使用自定义标题色变量，统一标题样式 */
  overflow: hidden; /* 溢出隐藏：超出容器宽度的文字隐藏，为省略号做准备 */
  text-overflow: ellipsis; /* 文本溢出处理：超出部分显示省略号（...） */
  white-space: nowrap; /* 强制不换行：标题始终单行显示，不折行 */
}

/* 左侧侧边栏：固定宽度，右侧边框分隔 */
.sideleft {
  height: 100%;
  background: var(--color-sidebar-surface);
  width: 400px;
  border-right: 1px solid var(--color-border-strong);
}

/* 右侧聊天面板：占满剩余宽度，弹性布局垂直排列 */
.sideright {
  height: 100%;
  width: 100%;
  background: var(--color-panel-alt);
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 移动端遮罩层：侧边栏展开时显示，半透明模糊背景 */
.mobile-overlay {
  position: fixed;
  inset: 0; /* 等同于 top:0; right:0; bottom:0; left:0 */
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px); /* 毛玻璃效果 */
  z-index: 10; /* 低于侧边栏和头部 */
}

/* 响应式布局：屏幕宽度 ≤ 1024px（移动端） */
/* 媒体查询：屏幕宽度 ≤ 1024px（平板/手机）时应用以下样式 */
@media (max-width: 1024px) {
  .box {
    flex: 1; /* 让容器占满父元素剩余空间，适配flex布局 */
    position: relative; /* 相对定位：作为子元素绝对/固定定位的参考 */
  }

  /* 显示移动端头部（覆盖默认的display: none） */
  .mobile-header {
    display: flex;
  }

  /* 侧边栏改为固定定位，默认隐藏在左侧（translateX(-100%)） */
  .sideleft {
    position: fixed; /* 固定定位：脱离文档流，始终相对于视口定位 */
    top: 0; /* 顶部对齐视口 */
    left: 0; /* 左侧对齐视口 */
    bottom: 0; /* 底部对齐视口（高度铺满屏幕） */
    width: min(360px, 85vw); /* 宽度：取360px和85%视口宽度中的较小值，适配不同屏幕 */
    max-width: 100%; /* 最大宽度不超过100%视口，避免溢出 */
    transform: translateX(-100%); /* 初始向左偏移100%，隐藏在屏幕左侧 */
    transition: transform 0.25s ease, box-shadow 0.25s ease; /* 过渡动画：位移/阴影变化0.25秒缓动 */
    z-index: 11; /* 层级：高于遮罩层（通常z-index=9/10），低于移动端头部（z-index=12） */
    box-shadow: none; /* 初始无阴影，激活后添加 */
  }

  /* 侧边栏激活状态,也就是两个类名都生效才执行，移到可视区域，添加阴影增强层次感 */
  .sideleft .is-mobile-active {
    transform: translateX(0); /* 位移归0，显示在屏幕左侧 */
    box-shadow: 12px 0 32px rgba(59, 162, 221, 0.24); /* 右侧添加阴影，区分侧边栏和主内容 */
  }

  /* 聊天面板占满整个宽度（大屏时可能有固定宽度，小屏适配全屏） */
  .sideright {
    width: 100%;
  }
}

/* 响应式布局：屏幕宽度 ≤ 640px（小屏手机，如iPhone系列） */
@media (max-width: 640px) {
  /* 缩小移动端头部内边距，适配小屏显示 */
  .mobile-header {
    padding: 10px 14px;
  }

  /* 缩小操作按钮尺寸，更贴合小屏手持体验 */
  .mobile-header__action {
    width: 36px;
    height: 36px;
  }

  /* 缩小标题字体大小，保证小屏不挤压布局 */
  .mobile-header__title {
    font-size: 15px;
  }
}
</style>
