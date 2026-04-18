<!-- 历史会话管理侧边栏组件。它负责维护和展示所有历史对话记录，
集成了实时搜索过滤、时间轴自动排序、主题模式切换、以及对单个会话进行新建、重命名、删除或清空的完整管理功能。 -->
<script setup>
import { computed, nextTick, ref } from "vue";

import {
  ChatDotRound,
  Close,
  Delete,
  EditPen,
  Moon,
  Plus,
  Search,
  Sunny,
} from "@element-plus/icons-vue";

import { useSessionStore } from "@/stores/session";
import { useThemeStore } from "@/stores/theme";

defineOptions({ name: "ConversationSidebar" });

const emit = defineEmits(["callR"]);
const sessionStore = useSessionStore();
const themeStore = useThemeStore();

const keyword = ref("");
const listRef = ref(null);

// 判断是否为暗黑模式
const isDark = computed(() => themeStore.mode === "dark");

// 切换浅色/暗黑主题
const toggleTheme = () => {
  themeStore.toggleMode();
};

/**
 * 根据会话名称组装摘要信息，包括最后一条消息、更新时间等
 * 供侧边栏列表渲染使用。
 * [
  {
    name: "chat_20260401_01",
    updatedAt: 1712739200000, // 从 time 变量提取的时间戳
    preview: "帮我写一个 Vue 3 的上传组件..." // 截取的前 50 个字符
  },..........]
 */
const conversations = computed(() => {
  const names = sessionStore.getAllSessions();
  return names.map((name) => {
    const messages = sessionStore.session[name] ?? [];
    const lastMessage = messages[messages.length - 1];
    const time = sessionStore.time[name] ?? 0;
    // isArray判断是不是数组
    const attachmentNames = Array.isArray(lastMessage?.attachments)
      ? lastMessage.attachments.map((item) => item.name).join("、")
      : "";

    // 生成消息预览文本（逻辑：优先取消息内容 → 无内容则取附件 → 都没有显示“空对话”）
    const previewText =
    lastMessage?.content?.trim()
    ? lastMessage.content.replace(/\s+/g, " ")
    : attachmentNames
    ? `附件: ${attachmentNames}`
    : "空对话";

    return {
      name,
      updatedAt: time,
      preview: previewText.slice(0, 50),
    };
  });
});

/**
 * 将时间戳转换为可读的“刚刚/几分钟前”形式，提升可读性。
 */
const formatTime = (timestamp) => {
  if (!timestamp) return "未开始";
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;//floor是去掉小数，向下取整
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  //转化为日期对象，并且toLocaleString变好看，不是时间戳而是更美观的
  return new Date(timestamp).toLocaleString();
};


/**
 * 结合搜索关键字过滤、排序会话，使最近的记录优先显示。
 */
const filteredConversations = computed(() => {
  const query = keyword.value.trim().toLowerCase();

  return conversations.value
    .map((conversation) => ({
      ...conversation,
      timeLabel: formatTime(conversation.updatedAt),
    }))
    .filter((conversation) =>
      !query ||
      conversation.name.toLowerCase().includes(query) ||
      conversation.preview.toLowerCase().includes(query),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
});


// 新建一个对话，清空搜索框并滚动到顶部
const newChat = async () => {
  const { created } = sessionStore.newchat();
  keyword.value = "";
  await nextTick();
  //setScrollTop卷上去的高度函数，（0）意思是卷上去。
  listRef.value?.setScrollTop?.(0);
  if (created) {
    ElMessage.success("已创建新对话");
  } else {
    ElMessage.info("已切换到等待输入的新对话");
  }
};

// 清空所有历史对话，带确认提示框
const clearHistory = () => {
  if (!sessionStore.getAllSessions().length) {
    return;
  }

  ElMessageBox.confirm("确认清空全部对话记录吗？", "清空历史", {
    confirmButtonText: "清空",
    cancelButtonText: "取消",
    type: "warning",
    center: true,
  })
    .then(() => {
      sessionStore.clear();
      keyword.value = "";
      ElMessage.success("已清空历史对话");
    })
    .catch(() => {});
};

// 删除单条对话记录
const deleteHistory = (name) => {
  sessionStore.deletehistory(name);
  ElMessage.success("对话已删除");
};

// 选中历史对话，通知父组件切换会话
const selectHistory = (name) => {
  emit("callR", name);
};

// 重命名对话标题，带输入校验
const renameConversation = (name) => {
  ElMessageBox.prompt("请输入新的对话标题", "重命名对话", {
    inputValue: name,
    confirmButtonText: "保存",
    cancelButtonText: "取消",
    center: true,
  })
    .then(({ value }) => {
      if (!value.trim()) {
        ElMessage.warning("标题不能为空");
        return;
      }
      if (value === name) return;
      sessionStore.selecthistory(name);
      sessionStore.updateTitle(value.trim());
      ElMessage.success("标题已更新");
    })
    .catch(() => {});
};
</script>



<template>
  <aside class="sidebar">
    <!-- 左侧栏头部，包含品牌标识、主题切换和新建对话按钮 -->
    <header class="sidebar-header">
      <div class="brand-row">
        <div class="brand">
          <span class="brand__title">DeepSeek</span>
          <span class="brand__subtitle">智能对话助手</span>
        </div>
        <!-- text,的意思是变为文字按钮 -->
        <el-button text class="theme-toggle" @click="toggleTheme">
          <el-icon class="theme-toggle__icon">
            <component :is="isDark ? Sunny : Moon" />
          </el-icon>
          <span>{{ isDark ? "日间模式" : "夜间模式" }}</span>
        </el-button>
      </div>
      <el-button type="primary" class="new-chat-btn" @click="newChat">
        <el-icon><Plus /></el-icon>
        <span>新建对话</span>
      </el-button>
    </header>

    <!-- 历史记录工具区：搜索框 + 统计信息
        clearable输入框的清除按钮
        :prefix-icon="Search"输入框前缀为，放大镜
     -->
    <div class="sidebar-tools">
      <el-input
        v-model="keyword"
        placeholder="搜索历史对话"
        clearable
        :prefix-icon="Search"
        class="search-input"
      />
      <div class="sidebar-stats">
        <span>共 {{ filteredConversations.length }} 个对话</span>
        <el-button
          text
          size="small"
          class="clear-btn"
          @click="clearHistory"
        >
          <el-icon><Delete /></el-icon>
          清空
        </el-button>
      </div>
    </div>

    <!-- 历史会话列表，使用虚拟滚动条保持体验
     text按钮就变得透明，不是让按钮变为文字。而是显示文字或者图标，去除背景色-->
    <el-scrollbar ref="listRef" class="conversation-list">
      <transition-group name="slide-fade" tag="div">
        <div
          v-for="conversation in filteredConversations"
          :key="conversation.name"
          :class="['conversation-item', { active: conversation.name === sessionStore.curname }]"
          @click="selectHistory(conversation.name)"
        >
          <div class="conversation-item__main">
            <div class="conversation-item__title">{{ conversation.name }}</div>
            <time class="conversation-item__time">{{ conversation.timeLabel }}</time>
          </div>
          <div class="conversation-item__preview">{{ conversation.preview }}</div>
          <!-- 这里子盒子添加组织冒泡防止，点击删除触发父盒子的切换回话函数 -->
          <div class="conversation-item__actions" @click.stop>
            <el-button
              text
              size="small"
              class="rename-btn"
              @click="renameConversation(conversation.name)"
            >
              <el-icon><EditPen /></el-icon>
            </el-button>
            <el-button
              text
              size="small"
              class="delete-btn"
              @click="deleteHistory(conversation.name)"
            >
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>
      </transition-group>

      <div v-if="!filteredConversations.length" class="empty-state">
        <el-icon class="empty-state__icon"><ChatDotRound /></el-icon>
        <p>暂无历史记录，点击“新建对话”开始吧！</p>
      </div>
    </el-scrollbar>
  </aside>
</template>



<style scoped>

.sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 18px;
  background: var(--color-sidebar-surface);
  border-right: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
}

.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.brand-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brand__title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-heading);
}

.brand__subtitle {
  font-size: 12px;
  color: var(--color-muted);
  letter-spacing: 1.5px;
  /* 全部大写 */
  text-transform: uppercase;
}

.theme-toggle {
  border-radius: 999px !important;
  padding: 6px 12px !important;
  height: auto !important;
  color: var(--color-text-secondary) !important;
  background-color: transparent !important;
  border: none !important;
  transition: background-color 0.2s ease, color 0.2s ease !important;
}

.theme-toggle:hover {
  color: var(--color-heading) !important;
  background-color: rgba(148, 163, 184, 0.16) !important;
}

.theme-toggle__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 继承父元素颜色 */
  color: inherit;
}

.theme-toggle span {
  font-size: 12px;
}

.new-chat-btn {
  width: 100%;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--color-accent-strong), var(--color-accent));
  border: none;
  box-shadow: var(--shadow-soft);
  color: var(--color-accent-contrast);
}

.new-chat-btn span {
  margin-left: 6px;
}

.sidebar-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 14px;
  background: var(--color-input-background);
  border: 1px solid var(--color-border);
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
}

.sidebar-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--color-muted);
}

.clear-btn {
  color: var(--color-danger);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.clear-btn:hover {
  color: var(--color-danger-strong);
}

.conversation-list {
  flex: 1;
  overflow: hidden;
}

.conversation-item {
  position: relative;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
  margin-bottom: 12px;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border: 1px solid transparent;
  color: inherit;
}

.conversation-item:last-child {
  margin-bottom: 0;
}

.conversation-item:hover {
  transform: translateX(8px);
  box-shadow: var(--shadow-strong);
}

.conversation-item.active {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-strong);
}

.conversation-item__main {
  display: flex;
  justify-content: flex-start;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  padding-right: 60px; /* 4. 安全距离：给右侧的绝对定位按钮留出专属空地，防止文字长了被按钮挡住 */
}

.conversation-item__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex-shrink: 1; /* 5. 允许标题被挤压，如果太长就出省略号 */
  overflow: hidden;
  /* 以下，省略号，不拐弯 */
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-item__time {
  font-size: 11px;
  color: var(--color-muted);
  flex-shrink: 0; /* 6. 铁律：时间是死规定，宁死不缩，坚决不能变成省略号 */
}
.conversation-item__preview {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  height: 3em;
  overflow: hidden;
  /* 末尾显示省略号 */
  text-overflow: ellipsis;
}

.conversation-item__actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.conversation-item:hover .conversation-item__actions,
.conversation-item.active .conversation-item__actions {
  opacity: 1;
}

.rename-btn,
.delete-btn {
  color: var(--color-muted);
}

.rename-btn:hover,
.delete-btn:hover {
  color: var(--color-text-primary);
}

.empty-state {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--color-muted);
  text-align: center;
}

.empty-state__icon {
  font-size: 32px;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

@media (max-width: 960px) {
  .sidebar {
    padding: 16px;
  }
}

@media (max-width: 1024px) {
  .sidebar {
    width: 100%;
    max-width: none;
    border-right: none;
    border-bottom: 1px solid var(--color-border-strong);
    box-shadow: none;
  }

  .sidebar-header {
    flex-direction: column;
    align-items: stretch;
  }

  .brand-row {
    align-items: flex-start;
  }

  .new-chat-btn {
    height: 42px;
  }

  .conversation-list {
    padding-bottom: 80px;
  }
}

@media (max-width: 640px) {
  .sidebar {
    padding: 16px 14px 24px;
  }

  .brand__title {
    font-size: 20px;
  }

  .conversation-item {
    padding: 12px 14px;
  }
}
</style>
