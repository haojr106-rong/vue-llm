// 从 Vue 核心库导入创建应用实例的方法
import { createApp } from "vue";
// 从 Pinia 库导入创建状态管理实例的方法
import { createPinia } from "pinia";
//插件就是主程序多出来的功能，插件的代码运作在主程序里，api不在本地程序里，跑在服务器中，你无需知道他运作逻辑，只关心结果
// 导入 Pinia 持久化插件，用于实现状态本地存储，f5刷新后，数据保存在localstore中
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
// 导入 Vue 虚拟滚动插件，用于优化长列表渲染性能
import VueVirtualScroller from "vue-virtual-scroller";
// 导入虚拟滚动插件的样式文件
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";


// 导入根组件，App名字自己定的，原因是vite在底层构建时默认暴露了.vue的内容，默认暴露在导入时，名字自己取。
import App from "./App.vue";
// 导入主题相关的 Pinia Store
import { useThemeStore } from "@/stores/theme";

// 创建 Vue 应用实例，为什么：App理解为图纸，创建为实例才知道在哪里挂载，也就是渲染在页面的位置，还能用很多方法，app.use(pinia);
const app = createApp(App);
// 创建 Pinia 状态管理实例
const pinia = createPinia();

// 为 Pinia 注册持久化插件，实现所有 Store 状态的本地持久化
// 效果：页面刷新后 Pinia 中的状态不会丢失，仍能保留会话记录
pinia.use(piniaPluginPersistedstate);

// 全局注册 VueVirtualScroller 插件，项目中所有组件都可使用虚拟滚动相关组件
app.use(VueVirtualScroller);

// 将 Pinia 实例挂载到 Vue 应用上，使整个应用具备状态管理能力
app.use(pinia);

// 在应用挂载前，初始化主题 Store 实例
const themeStore = useThemeStore();
// 执行主题初始化方法，同步当前系统/用户设置的主题模式
themeStore.initialize();

// 将 Vue 应用实例挂载到页面中 id 为 app 的 DOM 节点上，完成应用启动
app.mount("#app");
