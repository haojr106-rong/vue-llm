import { ref } from "vue";
import { defineStore } from "pinia";

// 默认会话名称，用于初始化以及兜底
const DEFAULT_SESSION_NAME = "新对话";

const MODEL_OPTIONS = Object.freeze([
  {
    // Object.freeze冻结对象
    label: "DeepSeek Reasoner (推理增强)",
    value: "deepseek-reasoner",
  },
  {
    label: "DeepSeek Chat (快速对话)",
    value: "deepseek-chat",
  }
]);

//文件尺寸大小函数
//.toFixed(1) 就是指定保留 1 位小数，四舍五入
const formatFileSize = (size) => {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};

// 将附件对象描述为更易读的字符串，方便拼接到模型上下文
const describeAttachment = (attachment) => {
  if (!attachment) return "";
  const { name, size, type, body, note } = attachment;

  const header = [`文件名: ${name}`, `大小: ${formatFileSize(size)}`];
  if (type) {
    header.push(`类型: ${type}`);
  }

  const bodyText = body
    // 拼接内容预览文本：\n 是换行符，.slice(0, 4000)：截取字符串的前 4000 个字符
    ? `内容预览:\n${(body || "").slice(0, 4000)}`
    : note || "未提供内容";

  //join字符串拼接，用|拼接
  return `${header.join(" | ")}\n${bodyText}`;
};


export const useSessionStore = defineStore(
  "session",
  () => {
    // [变量名] 这种包裹在对象属性位置的写法，是 ES6 新增的计算属性名语法，核心作用是：
    // 把变量的值作为对象的属性名，而不是把变量名本身作为属性名。
    // 核心：存储所有会话的消息记录，结构为 { 会话名称: 消息数组 }，初始默认会话为空数组，信息数组【】里面也是对象，
    const session = ref({ [DEFAULT_SESSION_NAME]: [] });
    // 当前激活的会话名称，初始为默认会话名
    const curname = ref(DEFAULT_SESSION_NAME);
    // 存储每个会话的最后活跃时间戳，结构为 { 会话名称: 时间戳 }，用于会话排序/展示
    const time = ref({});
    // 存储每个会话的思考链/推理过程，结构同session，{ 会话名称: 推理文本数组 }
    const reason = ref({ [DEFAULT_SESSION_NAME]: [] });
    // 控制每个会话中每条思考链的显示/隐藏状态，结构 { 会话名称: [布尔值数组] }
    const showreason = ref({ [DEFAULT_SESSION_NAME]: [] });
    // 控制每个会话是否可见（用于过滤未输入内容的空会话），结构 { 会话名称: 布尔值 }，初始默认会话不可见（无消息）就是左侧有没有的问题
    const visibility = ref({ [DEFAULT_SESSION_NAME]: false });
    // 标记待输入的空会话名称（新创建但未发消息的会话），初始为默认会话名
    const pendingConversation = ref(DEFAULT_SESSION_NAME);
    // 当前选中的AI模型值（如deepseek-reasoner），初始为第一个模型选项
    const model = ref(MODEL_OPTIONS[0].value);


    //A ?? B → 只有 A 是 null/undefined 时，才用 B，否则用 A，拿到属性值的方法，obj.属性名或者obj[属性名]
    if ((session.value[DEFAULT_SESSION_NAME]?.length ?? 0) > 0) {
      //你这个对话有信息，左侧才能显示
      visibility.value[DEFAULT_SESSION_NAME] = true;
      pendingConversation.value = null;
    }


    // 确保会话相关的所有数据结构都已初始化（核心兜底逻辑）
    const ensureConversation = (
      name = curname.value,
      //不传makeVisibleIfNew = true ，或者你告诉他makeVisibleIfNew = false 写法比较特殊，默认true是大概率让你看见的意思
      { makeVisibleIfNew = true } = {}
    ) => {
      // 判断当前会话是否已存在（双!!将值转为布尔值）
      const exists = !!session.value[name];

      // 初始化只给“新对话”创建了空数组，有新的对话名了，没发信息，也得给他创建空数组
      if (!exists) {
        session.value[name] = [];
      }
      // 2. 若该会话的思考链数组未初始化，创建空数组
      if (!reason.value[name]) {
        reason.value[name] = [];
      }
      // 3. 若该会话的思考链显示状态数组未初始化，创建空数组
      if (!showreason.value[name]) {
        showreason.value[name] = [];
      }
      // 4. 若该会话的最后活跃时间未初始化：已存在的会话取当前时间戳，新会话置为0，也就是这个会话不存在就为0
      if (time.value[name] === undefined) {
        time.value[name] = exists ? Date.now() : 0;
      }

      // 5. 若该会话的可见状态未初始化：根据消息数组是否有内容决定是否可见（有消息则显示）
      if (visibility.value[name] === undefined) {
        visibility.value[name] = session.value[name].length > 0;
      }

      // 6. 若为新会话且要求不显示：强制置为不可见，并标记为待输入空会话，修改完对话名了还没输入，这个没用上，属于扩展业务，
      if (!exists && !makeVisibleIfNew) {
        visibility.value[name] = false;
        pendingConversation.value = name;
      }
      // 7. 若为新会话且无特殊隐藏要求：强制置为可见，这个else if逻辑很乱，意思上述不满足!makeVisibleIfNew，这里满足他了，
      // 修改了会话名没有聊天，左侧显示，因为让makeVisibleIfNew为true
      else if (!exists) {
        visibility.value[name] = true;
      }
    };

    /**
    * 生成不重复的新会话名称（核心：避免和已有会话名重复）
    * 规则：先检查默认名"新对话"是否可用，不可用则依次生成"新对话 1"、"新对话 2"...直到找到未使用的名称
    */
    const generateConversationName = () => {
      // 基础会话名（默认值："新对话"）
      const base = DEFAULT_SESSION_NAME;

      // 1. 先判断默认名"新对话"是否未被使用 → 可用则直接返回
      if (!session.value[base]) {
        return base;
      }

      // 2. 若默认名已被占用，从1开始递增生成新名称
      let index = 1;
      // 候选名称：拼接成"新对话 1"
      let candidate = `${base} ${index}`;

      // 3. 循环检查候选名称是否已存在 → 存在则序号+1，直到找到未使用的名称
      while (session.value[candidate]) {
        index += 1; // 序号递增（1→2→3...）
        candidate = `${base} ${index}`; // 重新拼接候选名（"新对话 2"→"新对话 3"...）
      }

      // 4. 返回最终未被占用的新会话名
      return candidate;
    };

    /**
      * 反转指定消息的思考链显示状态。
      */
    const toggleReasonVisibility = (index) => {
      ensureConversation();
      const key = curname.value;
      if (showreason.value[key][index] === undefined) {
        showreason.value[key][index] = true;
      }
      showreason.value[key][index] = !showreason.value[key][index];
    };

    /**
     * 向当前会话追加一条消息，同时记录最近活跃时间，ai的自己的都追加。
     */
    const sessionpush = (msg) => {
      const key = curname.value;
      ensureConversation(key);

      const normalized = {
        role: msg.role,
        content: msg.content ?? "",
        attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
  };

      session.value[key].push(normalized);

      // 【核心修正】：只有是 assistant 的时候，我们才可能需要展开思考，
      reason.value[key].push("");
      // 如果是 assistant，默认给 true（展开）；如果是 user，给 false（不显示）
      showreason.value[key].push(msg.role === "assistant");
      time.value[key] = Date.now();
      visibility.value[key] = true;
      if (pendingConversation.value === key) {
        pendingConversation.value = null;
      }
    };



    // 模型选择，这里传输的就是模型的两个value之一
    const setModel = (value) => {
      //some是数组中至少有一个元素的方法
      const exists = MODEL_OPTIONS.some((option) => option.value === value);
      if (exists) {
        model.value = value;
      }
    };

    /**
     * 返回所有可见会话的名称列表，返回的是一个数组
     */
    const getAllSessions = () =>
      //Object.keys() 接收一个对象作为参数，返回一个由该对象的所有可枚举属性名（键名）组成的数组。
      Object.keys(session.value)
        .filter((name) => {
          if (visibility.value[name] === undefined) {
            visibility.value[name] = session.value[name].length > 0;
          }
          //筛选返回不等于false的
          return visibility.value[name] !== false;
        })
        // 【修改点】：添加根据 time 倒序排列，保证最新的会话在侧边栏最上方
        .sort((a, b) => (time.value[b] || 0) - (time.value[a] || 0));

    /**
     * 创建一个空白会话，标记为待输入状态，
     * 想一下，你创建一个会话，没改名没输入信息，怎么判定你点击了创建按钮，答案是pendingConversation.value = name，
     * 当他可以出现在左侧在删除这个中间量，假如你跳转了，不需要这个还没用的新对话，直接pendingConversation.value = null
     */
    const createBlankConversation = (name) => {
      session.value[name] = [];
      reason.value[name] = [];
      showreason.value[name] = [];
      time.value[name] = 0;
      visibility.value[name] = false;
      pendingConversation.value = name;
    };

    /**
     * 清空所有历史记录并创建新的占位会话。
     */
    const clear = () => {
      session.value = {};
      reason.value = {};
      showreason.value = {};
      time.value = {};
      visibility.value = {};
      //都删除了，generateConversationName返回默认新会话id，此时到了待输入状态了，
      const name = generateConversationName();
      createBlankConversation(name);
      curname.value = name;
    };


    /* 更新会话标题的核心函数
     * @param {string} newTitle - 新的会话标题（可能包含首尾空白）
     */
    const updateTitle = (newTitle) => {
      // 1. 容错处理：若newTitle为undefined/null则返回空，否则移除首尾空白字符
      // ?. 是可选链操作符，避免newTitle为null/undefined时调用trim()报错
      const trimmed = newTitle?.trim();

      // 2. 边界判断：如果处理后的标题为空字符串，直接退出函数（不执行后续逻辑）
      if (!trimmed) {
        return;
      }

      // 3. 获取当前的会话名称（旧标题）
      const current = curname.value;

      // 4. 重复判断：如果新标题和旧标题完全一致，无需更新，直接退出
      if (trimmed === current) {
        return;
      }

      // 5. 特殊场景：如果新标题已存在于session中，不允许改名，
      if (session.value[trimmed]) {
        // 更新当前会话名为新标题
        curname.value = trimmed;
        // 标记新标题对应的会话为“可见”状态
        visibility.value[trimmed] = true;
        // 清空待处理的会话缓存
        pendingConversation.value = null;
        // 退出函数（无需执行后续的复制/删除逻辑）
        return;
      }

      //   const updateTitle = (newTitle) => {
      //   // 1. 基础校验：去空格、判空、判是否没改
      //   const trimmed = newTitle?.trim();
      //   if (!trimmed) return;

      //   const current = curname.value;
      //   if (trimmed === current) return;

      //   // 2. 兜底：确保现在的 10 条数据是完整的
      //   ensureConversation(current);

      //   // ---------------- 高潮来了：无情覆盖 ----------------

      //   // 3. 强行克隆并覆盖：
      //   // 这一句极其暴力！如果 trimmed(例如id1)原来有5条信息，
      //   // 此时它的旧地址直接被扯断，换上了 current(10条) 的新地址！
      //   // 原来的 5 条信息瞬间变成代码世界的孤儿，被系统垃圾回收（彻底毁灭）。
      //   session.value[trimmed] = session.value[current];
      //   reason.value[trimmed] = reason.value[current];
      //   showreason.value[trimmed] = showreason.value[current];

      //   if (time.value[current]) {
      //     time.value[trimmed] = time.value[current];
      //   }

      //   // 4. 状态切换：把屏幕切过去，并擦屁股
      //   curname.value = trimmed;         // 画面切到新名字
      //   visibility.value[trimmed] = true;// 确保可见
      //   pendingConversation.value = null;// 撕掉可能存在的草稿标签

      //   // 5. 过河拆桥：把改名前的旧壳子彻底销毁
      //   delete session.value[current];
      //   delete reason.value[current];
      //   delete showreason.value[current];
      //   delete time.value[current];
      //   delete visibility.value[current];
      // };


      // 6. 改的名不重复，确保旧标题对应的会话数据已初始化（防止数据缺失）
      ensureConversation(current);
      // 7. 复制旧标题的所有关联数据到新标题下
      // 复制会话核心内容
      session.value[trimmed] = session.value[current];
      // 复制会话对应的原因描述
      reason.value[trimmed] = reason.value[current];
      // 复制会话原因的显示状态
      showreason.value[trimmed] = showreason.value[current];
      // 复制会话的时间戳（容错：仅当旧标题有时间数据时才复制）
      if (time.value[current]) {
        time.value[trimmed] = time.value[current];
      }
      // 8. 标记新标题的会话为“可见”状态
      visibility.value[trimmed] = true;

      // 9. 删除旧标题对应的所有关联数据（完成数据迁移）
      delete session.value[current];
      delete reason.value[current];
      delete showreason.value[current];
      delete time.value[current];
      delete visibility.value[current];

      // 10. 最终更新当前会话名为新标题，并清空待处理会话缓存
      curname.value = trimmed;
      pendingConversation.value = null;
    };


    /**
    * 删除指定索引位置的消息（及关联的原因/显示状态数据）
    * @param {number} index - 要删除的消息在数组中的索引位置
    */
    const removeMessageAt = (index) => {
      // 1. 确保当前会话（curname.value）的基础数据已初始化，避免操作不存在的会话
      ensureConversation();

      // 2. 获取当前会话的名称（键名）
      const key = curname.value;

      // 3. 获取当前会话下的所有消息数组
      const messages = session.value[key];

      // 4. 边界校验：若消息数组不存在/索引为负数/索引超出数组长度，直接退出（避免报错）
      if (!messages || index < 0 || index >= messages.length) {
        return;
      }

      // 这里的删除因为 sessionpush 里的同步逻辑，变得绝对安全且不会错位了
      // 5. 删除消息数组中指定索引的元素splice(index, 1) 表示从index位置删除1个元素
      messages.splice(index, 1);

      // 6. 容错删除：若reason中存在当前会话的数组，删除对应索引的原因数据（?. 避免数组不存在时报错）
      reason.value[key]?.splice(index, 1);

      // 7. 容错删除：若showreason中存在当前会话的数组，删除对应索引的显示状态数据
      showreason.value[key]?.splice(index, 1);

      // 8. 若删除后消息数组为空，将当前会话的时间戳置为0（标记会话无有效消息）
      if (!messages.length) {
        time.value[key] = 0;
      }
    };


    /**
    * 截断指定起始索引后的所有消息（保留前startIndex条消息），假如你重新生成第2条信息，后面的都会被删除
    * 因为上下文是有关联的
    * @param {number} startIndex - 截断起始索引，索引及之后的消息都会被移除
    */
    const trimMessagesFrom = (startIndex) => {
      // 1. 确保当前会话（curname.value）的基础数据已初始化，避免操作不存在的会话
      ensureConversation();

      // 2. 获取当前会话的名称（作为操作各数据对象的键名）
      const key = curname.value;

      // 3. 获取当前会话下的所有消息数组
      const messages = session.value[key];

      // 4. 边界校验：若消息数组不存在/起始索引为负数，直接退出（避免无效/错误操作）
      if (!messages || startIndex < 0) {
        return;
      }

      // 5. 有效索引判断：仅当起始索引小于消息数组长度时，执行截断操作
      if (startIndex < messages.length) {
        // 5.1 截断消息数组：保留从0到startIndex（不包含）的元素，覆盖原数组，slice截取，
        session.value[key] = messages.slice(0, startIndex);

        // 5.2 截断原因数组：先容错（无数据则置为空数组），再保留前startIndex个元素
        // ?? [] 是空值合并运算符，避免reason.value[key]为undefined/null时调用slice报错
        reason.value[key] = (reason.value[key] ?? []).slice(0, startIndex);

        // 5.3 截断显示状态数组：同原因数组，容错后保留前startIndex个元素，保证数据同步
        showreason.value[key] = (showreason.value[key] ?? []).slice(0, startIndex);
      }
    };


    /**
    * 删除指定名称的会话历史数据，并处理当前会话的兜底逻辑
    * @param {string} name - 要删除的会话名称（键名）
    */
    const deletehistory = (name) => {
      // 1. 标记要删除的会话是否是当前正在使用的会话
      const wasCurrent = name === curname.value;

      // 2. 批量删除该会话的所有关联数据（核心删除逻辑）
      delete session.value[name];    // 删除会话的消息主体数据
      delete time.value[name];       // 删除会话的时间戳数据
      delete reason.value[name];     // 删除会话的原因描述数据
      delete showreason.value[name]; // 删除会话原因的显示状态数据
      delete visibility.value[name]; // 删除会话的可见性状态数据

      // 3. 若待处理会话缓存指向当前删除的会话，清空该缓存（避免缓存指向不存在的会话）
      if (pendingConversation.value === name) {
        pendingConversation.value = null;
      }

      // 4. 获取删除后剩余的所有会话名称（键名数组）
      const remaining = Object.keys(session.value);

      // 5. 兜底逻辑：如果删除的是当前正在使用的会话，需要重新指定新的当前会话
      if (wasCurrent) {
        // 5.1 从剩余会话中筛选出“最新更新”的会话（按时间戳降序排序后取第一个）
        // - map：将会话名转为 {key: 会话名, updatedAt: 时间戳} 格式（时间戳容错为0）
        // - sort：按updatedAt降序排序（最新的排在前面）
        // - [0]?.key：取排序后第一个会话名（?. 避免剩余会话为空时报错）
        const fallback = remaining
          .map((key) => ({ key, updatedAt: time.value[key] ?? 0 }))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.key;

        // 5.2 若存在剩余会话，将最新的会话设为当前会话
        if (fallback) {
          ensureConversation(fallback); // 确保新会话的基础数据已初始化
          curname.value = fallback;     // 更新当前会话名为最新会话
          return; // 兜底完成，退出函数
        }

        // 5.3 若没有剩余会话（所有会话都被删完），创建一个全新的空白会话
        const fallbackName = generateConversationName(); // 生成新的会话名称
        createBlankConversation(fallbackName);           // 创建空白会话的基础数据
        curname.value = fallbackName;                    // 将新会话设为当前会话
      }
    };


    /**
     * 切换当前会话，必要时自动初始化数据。
     * @param {string} name - 要切换的目标会话名称
     */
    const selecthistory = (name) => {
      // 校验：会话名存在 且 与当前激活会话不同时才执行切换
      if (name && curname.value !== name) {
        // 确保目标会话的数据已初始化（不存在则创建）
        ensureConversation(name);
        // 更新当前激活的会话名称为目标会话
        curname.value = name;
      }
    };

    /**
     * 获取当前会话的消息列表，附带虚拟滚动所需的唯一key。
     * @returns {Array<Object>} 格式化后的消息列表（含虚拟滚动key、附件容错）
     */
    const getcurmsgs = () => {
      // 确保当前会话的数据已初始化
      ensureConversation();
      // 获取当前激活会话的原始消息数组
      const currentMessages = session.value[curname.value];

      // 映射消息数组：补充虚拟滚动key，对附件字段做容错处理
      return currentMessages.map((item, idx) => ({
        ...item, // 解构原始消息的所有属性
        // 附件字段容错：非数组则置为空数组，避免渲染报错
        attachments: Array.isArray(item.attachments) ? item.attachments : [],
        // 生成虚拟滚动唯一key（角色+索引），防止列表渲染错位
        _key: `${item.role}-${idx}`,
      }));
    };

    /**
     * 创建新的对话。当存在未使用的占位对话时直接切换过去。
     * @returns {Object} 新建结果：{ created: 是否新建会话, name: 会话名称 }
     */
    const newchat = () => {
      // 检查是否存在“未使用的占位会话”（有会话名但无消息）
      if (
        pendingConversation.value && // 存在待处理会话缓存
        session.value[pendingConversation.value] && // 该会话在session中存在
        (session.value[pendingConversation.value]?.length ?? 0) === 0 // 会话消息数组为空
      ) {
        // 切换到该占位会话
        curname.value = pendingConversation.value;
        // 初始化占位会话数据（makeVisibleIfNew: false → 新会话不强制显示）
        ensureConversation(curname.value, { makeVisibleIfNew: false });
        // 返回：未新建，使用已有占位会话
        return { created: false, name: curname.value };
      }

      // 无占位会话时，生成新的会话名称，点击创建先执行这个，啥也不干在点击就触发if
      const name = generateConversationName();
      // 创建空白会话的基础数据
      createBlankConversation(name);
      // 切换到新创建的会话
      curname.value = name;
      // 返回：已新建，返回新会话名称
      return { created: true, name };
    };


    /**
     * 将流式响应追加到最后一条消息中，这里应该是ai真是回复的信息
     * @param {string} delta - 流式返回的文本片段（如单个字/短语）
     */
    const adddelta = (delta) => {
      // 确保当前会话的数据已初始化
      ensureConversation();
      // 获取当前激活会话的名称
      const key = curname.value;
      // 获取当前会话的消息数组
      const messages = session.value[key];
      // 获取消息数组的最后一条消息（流式响应追加目标）
      const lastMessage = messages[messages.length - 1];

      // 存在最后一条消息时，追加流式文本片段
      if (lastMessage) {
        lastMessage.content += delta;
      }
    };

    /**
     * 将推理文本追加到当前会话的最后一个思考链中。
     * @param {string} delta - 推理文本片段
     */
    const add = (delta) => {
      // 确保当前会话的数据已初始化
      ensureConversation();
      // 获取当前激活会话的名称
      const key = curname.value;
      // 获取当前会话的推理文本数组
      const reasoningList = reason.value[key];

      // 【修改点】：使用具体的最后一条索引，保证稳定性
      const lastIndex = reasoningList.length - 1;
      // 校验：最后一条索引有效 且 对应值不为undefined时，追加推理文本
      if (lastIndex >= 0 && reasoningList[lastIndex] !== undefined) {
        reasoningList[lastIndex] += delta;
      }
    };


    /**
     * 将消息和附件概述拼接成模型可读的输入。
     * @returns {Array<Object>} 模型标准格式的消息数组（含role和格式化content）
     */
    const getMessagesForModel = () => {
      // 确保当前会话的数据已初始化
      ensureConversation();
      // 获取当前激活会话的名称
      const key = curname.value;
      // 映射每条消息为模型可读的标准格式
      return session.value[key].map((item) => {
        // 拼接附件描述文本：有附件时生成概述，无附件则为空
        const attachmentsText =
          item.attachments && item.attachments.length
            ? `\n\n附件:\n${item.attachments
              .map((attachment) => describeAttachment(attachment)) // 生成单个附件的描述文本
              .join("\n\n")}` // 多个附件用换行分隔
            : "";

        // 拼接消息内容+附件文本，移除首尾空白字符
        const content = `${item.content ?? ""}${attachmentsText}`.trim();

        // 返回模型标准格式：角色 + 内容（空内容替换为"(空消息)"）
        return {
          role: item.role,
          content: content || "(空消息)",
        };
      });
    };

    // 暴露store的属性和方法，供外部组件调用
    return {
      session, // 所有会话的消息数据（{ 会话名: 消息数组 }）
      curname, // 当前激活的会话名称
      sessionpush, // 推送消息到当前会话的方法
      getcurmsgs, // 获取当前会话格式化后的消息列表
      adddelta, // 追加流式响应到最后一条消息
      getAllSessions, // 获取所有有效会话名称数组
      newchat, // 创建新会话（优先使用占位会话）
      clear, // 清空当前会话数据
      deletehistory, // 删除指定会话及所有关联数据
      selecthistory, // 切换当前会话
      time, // 所有会话的时间戳数据（{ 会话名: 时间戳 }）
      updateTitle, // 更新会话标题（迁移旧数据）
      //reasonadd, // 添加推理文本到reason数组
      reason, // 所有会话的推理文本数据（{ 会话名: 推理数组 }）
      add, // 追加推理文本到最后一条思考链
      showreason, // 所有会话的推理文本显示状态（{ 会话名: boolean }）
      // 【修改点提醒】：依然保留 qiehuan，防止你页面模板里已经写了 store.qiehuan() 导致报错。
      // 但建议在未来重构组件代码时，逐步替换成 toggleReasonVisibility。
      qiehuan: toggleReasonVisibility,
      toggleReasonVisibility, // 切换推理文本的显示/隐藏状态
      getMessagesForModel, // 获取模型可读的标准化消息数组
      visibility, // 所有会话的可见性状态（{ 会话名: boolean }）
      pendingConversation, // 待处理的会话名称（占位会话）
      removeMessageAt, // 删除指定索引的消息及关联数据
      trimMessagesFrom, // 截断指定索引后的所有消息
      model, // 当前选中的模型名称
      modelOptions: MODEL_OPTIONS, // 模型可选列表
      setModel, // 设置当前使用的模型
    };
  },
  {
    persist: true, // 开启store持久化，页面刷新后数据不丢失
  },
);
