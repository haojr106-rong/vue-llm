import { computed, ref } from "vue";
import { defineStore } from "pinia";

//增加代码的健壮性，方便排错和修改
const THEME_STORAGE_KEY = "theme";


// defineStore 的作用就是打破组件的物理隔离，在云端建立一个全局共享的仓库。

// 任何组件都可以随时从这个仓库里拿数据（比如拿历史聊天记录）。

// 任何组件也可以随时调用仓库里的方法去改数据（比如新增一条消息）。

// 最牛的是： 仓库里的数据一旦被某个组件修改，全网所有用到这个数据的组件都会瞬间自动刷新界面！

//"theme"仓库名，和const THEME_STORAGE_KEY = "theme"; 没任何关系，
export const useThemeStore = defineStore("theme", () => {

  //全局主题
  const mode = ref("light");

  let mediaQuery;

  //把内存里的“主题变量”变成网页上看得见的“视觉样式”
  // value = mode.value默认参数，
  const applyTheme = (value = mode.value) => {
  // 第一步：安全检查。确保我们在浏览器环境，而不是服务器环境
  // document（网页）、window（浏览器窗口），区别
  if (typeof document === "undefined") return;
  // 第二步：找到网页的最顶层标签，也就是 <html> 标签，root= <html> 根元素
  // 主题切换99%都放在html标签上
  const root = document.documentElement;
  // 第三步：在 <html> 标签上打一个标记 data-theme="dark/light"
  // 这样 CSS 里的 [data-theme='dark'] 规则就能感应到了
  // root.dataset.theme = value 变为 <html data-theme=value>
  root.dataset.theme = value;
  // 第四步：开关 class 类名
  // 如果 value 是 "dark"，就给 <html> 加上 class="dark"
  // 如果 value 不是 "dark"，就把它身上的 "dark" 类名撕掉
  // root.classList.toggle(类名, 布尔值) true添加类名，false删除类名，<html class="dark">
  root.classList.toggle("dark", value === "dark");
};

  // 设置主题函数
  const setMode = (value) => {
    const normalized = value === "dark" ? "dark" : "light";
    if (mode.value === normalized) {
      applyTheme(normalized);
      return;
    }
    mode.value = normalized;
    applyTheme(normalized);
  };

  // 点击切换主题模式（在dark和light之间切换）
  const toggleMode = () => {
    setMode(mode.value === "dark" ? "light" : "dark");
  };


  // 系统主题偏好变化时的处理函数，系统偏好，1windows设置里会改变，2或者跟随时间变化，手动点击切换主题不会影响系统偏好，
  const handleSystemChange = (event) => {
    if (typeof localStorage !== "undefined") {
      //获取缓存中的THEME_STORAGE_KEY，存的时候键名是“theme”取得时候一样就行，比如localStorage.setItem(theme, { mode: "dark"});
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored) {
        //  相当于监听系统偏好设置，发现偏好设置变了，比如天黑了，但是localStorage存了当前的设置，以localStorage为主
        return;
      }
    }
    // 真正的偏好设置，也就是localStorage空的或者localStorage中theme盒子为空的，此时偏好设置终于发挥了，
    if (event.matches === true) {
    // 答：是的。那就把网页设为黑夜模式
      setMode("dark");
    } else {
    // 答：不是。那就把网页设为白天模式
      setMode("light");
      }
  };


  // 初始化主题：优先读取本地存储，其次跟随系统偏好，最后默认light，并监听系统主题变化
  const initialize = () => {
    if (typeof window === "undefined") {
      return;
    }

    let storedMode;

    if (typeof localStorage !== "undefined") {
      try {
        // 从本地存储有东西，不一定有没有“theme”，读取主题数据并解析：
        // 1. localStorage.getItem(THEME_STORAGE_KEY)：根据键名"theme"获取本地存储的字符串数据
        // 2. JSON.parse(...)：将本地存储的JSON字符串解析为JavaScript对象（本地存储只能存字符串，需解析还原）
        // 3. ?.mode：可选链操作符，防止解析后为null/undefined时访问.mode报错，仅当解析结果有值时才取.mode属性
        // 4. 最终将解析后的主题模式（dark/light）赋值给storedMode变量
        //"{"mode":"light"}" theme里的对象属性是这样的，theme相当于大箱子
        storedMode = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY))?.mode;
      } catch {
        storedMode = null;
      }
    }

    if (storedMode === "light" || storedMode === "dark") {
      mode.value = storedMode;
    } else {
      // 核心功能：检测用户的系统是否设置了「暗黑模式」偏好，返回布尔值（true/false）
      // 拆解说明：
      // 1. window.matchMedia?.(...)：可选链调用浏览器的媒体查询API，防止window.matchMedia不存在时报错
      // 2. "(prefers-color-scheme: dark)"：，这个属性浏览器内置的，不是自己起的名，媒体查询语句，查询系统的颜色方案偏好
      // 3. ?.matches：可选链读取查询结果的matches属性，返回是否匹配（true=暗黑模式，false=亮色模式）
      //{ （答案）matches: true, （你问的问题）media: "(prefers-color-scheme: dark)", ... }
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
      mode.value = prefersDark ? "dark" : "light";
    }
    // 上述逻辑已经修改了mode.value ，执行切换主题函数
    applyTheme();

    //初始化主题了，继续监听主题变化，这里监听的是系统偏好，是否支持window.matchMedia，有新版选新版事件监听方法。注意监听的是matches属性，也就是false和true
    if (window.matchMedia) {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      if (mediaQuery?.addEventListener) {
        mediaQuery.addEventListener("change", handleSystemChange);
      } else if (mediaQuery?.addListener) {
        mediaQuery.addListener(handleSystemChange);
        }
      }
    };

    // 清理系统主题监听事件，防止内存泄漏，注意，无需判断是否存在监听，没有也可以硬拆
    const cleanup = () => {
      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener("change", handleSystemChange);
      } else if (mediaQuery?.removeListener) {
        mediaQuery.removeListener(handleSystemChange);
      }
    };

    // 计算属性：判断当前是否为暗黑模式，这个完全是为了方便以后的逻辑判断，
    // 计算属性简单说就是定义一个响应式的需要计算的数据，ref定义的是响应式的无需计算的数据。
    const isDark = computed(() => mode.value === "dark");

  return {
    mode,
    isDark,
    initialize,
    cleanup,
    toggleMode,
    setMode,
    applyTheme,
  };
}, {
  persist: true,
});
