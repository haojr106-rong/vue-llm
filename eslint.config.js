// 导入ESLint扁平配置的核心函数和全局忽略工具
import { defineConfig, globalIgnores } from 'eslint/config'
// 导入全局环境变量定义包（用于声明window、document等全局变量）
import globals from 'globals'
// 导入ESLint官方的JavaScript规则配置
import js from '@eslint/js'
// 导入Vue专属的ESLint插件
import pluginVue from 'eslint-plugin-vue'

// 👇 1. 新增：导入 Node.js 原生的 fs 模块，用于读取文件
import fs from 'node:fs'

// 👇 2. 新增：读取并解析自动生成的白名单 JSON 文件
const autoImport = JSON.parse(
  fs.readFileSync(new URL('./.eslintrc-auto-import.json', import.meta.url), 'utf-8')
)

// 导出ESLint扁平格式的配置（ESLint v9+ 标准写法）
export default defineConfig([
  // 配置项：指定需要被ESLint检查的文件范围
  {
    // 自定义配置名称，仅用于识别，无实际功能
    name: 'app/files-to-lint',
    // 要检查的文件类型：js、mjs、jsx、vue文件
    files: ['**/*.{js,mjs,jsx,vue}'],
  },

  // 全局忽略规则：指定不需要ESLint检查的目录
  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  // 配置项：语言相关选项（全局变量、解析器等）
  {
    languageOptions: {
      // 声明全局可用的变量，避免ESLint报“未定义”错误
      globals: {
        // 继承browser环境的所有全局变量（如window、document等）
        ...globals.browser,
        // 👇 3. 新增：把自动导入的白名单变量（如 ElMessage）铺平放进全局变量里
        ...autoImport.globals,
      },
    },
  },

  // 启用ESLint官方推荐的JavaScript规则集
  js.configs.recommended,
  // 启用Vue插件的“flat/essential”规则集（适配扁平配置的核心必要规则）
  ...pluginVue.configs['flat/essential'],
])
