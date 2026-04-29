<script setup>
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'

// --- 配置區 ---
// 請確保此處的 URL 與教師端設定的完全一致
// ⚠️ 如果教師端分開了即時問答與測驗資料庫，請分別設定以下網址
// 開發環境使用 Vite Proxy 解決 CORS 問題，生產環境則使用完整 GAS 網址
const POLL_DATABASE_URL = 'https://script.google.com/macros/s/AKfycbxcPLSDEW3rL96lfSH9N0zTbfGSG-0xM8jMR7QAaR0t52XQoBAwj7pqVJFnemUNRE6fKg/exec';
const DATABASE_URL = 'https://script.google.com/macros/s/AKfycbyHUlQvBFXi6gtHqrLvS5dVKKDf8RLNSGGnxJs85zybPsmPT-X6DCwKR8gDkdq92VgSLA/exec';

const QUIZ_URL = import.meta.env.DEV 
  ? '/api-quiz/exec' 
  : DATABASE_URL;

// 即時問答 URL
const POLL_URL = import.meta.env.DEV ? '/api-poll/exec' : POLL_DATABASE_URL;

// --- 狀態管理 ---
const title = ref('測驗卷')
const currentTab = ref('quiz'); // 'quiz' 或 'poll'
const quizQuestions = ref([]); // 儲存從教師端抓取的題目
const studentName = ref('');    // 學生姓名
const isSubmitted = ref(false); // 是否已提交
const finalScore = ref(0);      // 計算出的分數
const isLoading = ref(true);    // 載入狀態
const errorMessage = ref('');    // 錯誤簡述 (顯示於畫面)
const errorDetail = ref('');     // 詳細錯誤資訊 (除錯用)

// 投票與回饋狀態
const activePolls = ref([]);     // 儲存所有即時題目
const isPollLoading = ref(false);
const pollErrorMessage = ref(''); // 投票與回饋錯誤
const pollErrorDetail = ref('');
const pollSubmissions = ref({});  // 追蹤每題提交狀態 { pollId: boolean }
const pollAnswers = ref({});      // 追蹤每題答案 { pollId: value }
const pollResults = ref({});       // 儲存每題的統計結果 { pollId: { labels: [], counts: [], total: 0 } }
let pollTimer = null;

// 當切換到投票與回饋分頁時，立即抓取一次資料
watch(currentTab, (newTab) => {
  if (newTab === 'poll') {
    fetchActivePoll();
  }
});

// 監聽姓名變化並存入本地儲存
watch(studentName, (newName) => {
  if (newName !== undefined) {
    localStorage.setItem('student_name', newName);
  }
});

// --- 計算作答進度 ---
const progressPercentage = computed(() => {
  if (quizQuestions.value.length === 0) return 0;
  
  const answeredCount = quizQuestions.value.filter(q => {
    if (q.type === 'multiple') {
      return Array.isArray(q.userAnswer) && q.userAnswer.length > 0;
    }
    return q.userAnswer !== null;
  }).length;

  return Math.round((answeredCount / quizQuestions.value.length) * 100);
});

// --- 1. 讀取題目 (Fetch Quiz) ---
const loadQuiz = async () => {
  isLoading.value = true;
  errorMessage.value = '';
  errorDetail.value = '';
  try {
    // 使用 Google Apps Script 的 GET 請求，並帶上 action 參數
    // 移除不必要的 headers 以確保觸發「簡單請求 (Simple Request)」
    const response = await fetch(`${QUIZ_URL}?action=getQuestions&_t=${Date.now()}`, {
      method: 'GET',
      redirect: 'follow' // Google Script 會進行多次重定向，這行很關鍵
    });
    
    if (!response.ok) {
      // 如果 HTTP 狀態碼不是 2xx，則拋出錯誤
      throw new Error(`HTTP 錯誤: ${response.status} - 無法從 Google Apps Script 取得題目。`);
    }
    
    // 先讀取文字，防止 JSON 解析失敗導致抓不到錯誤內容
    const rawText = await response.text();

    // 檢查是否為 HTML 報錯頁面
    if (rawText.trim().startsWith('<!DOCTYPE') || rawText.trim().startsWith('<html')) {
      const titleMatch = rawText.match(/<title>(.*?)<\/title>/i);
      const htmlTitle = titleMatch ? titleMatch[1] : '未知 HTML 頁面';
      
      errorMessage.value = `後端服務異常 [${htmlTitle}]`;
      errorDetail.value = `GAS 回傳了非 JSON 內容。\n\n常見原因與修復方案：\n1. 檢查 GAS 程式碼中是否有 "&gt;" 字樣（請手動改回符號 ">"）。\n2. 在「管理部署」中必須選擇【新版本】重新發布。\n3. 確保「執行身分」設定為【我】(Me) 且「誰可以存取」為【所有人】。\n\n檢查連結：\n${DATABASE_URL}?action=getQuestions`;
      isLoading.value = false;
      return;
    }

    let data;
    try {
      data = JSON.parse(rawText);
      console.log('從 GAS 接收到的原始資料:', data);

      // 檢查 GAS 主動捕捉並回傳的錯誤狀態
      if (data && data.status === 'error') {
        errorMessage.value = '後端程式執行出錯';
        errorDetail.value = `GAS 錯誤訊息: ${data.message}`;
        return;
      }
    } catch (parseError) {
      if (rawText.includes('errorMessage') || rawText.includes('script-error')) {
        errorMessage.value = 'Google Apps Script 執行發生內部錯誤';
        errorDetail.value = '請檢查 GAS 編輯器左側的「執行情形」日誌，通常是試算表權限或程式碼 Bug。';
      } else {
        errorMessage.value = '後端回傳內容並非 JSON 格式 (可能是登入頁面)';
        errorDetail.value = `解析失敗！收到內容開頭為：\n${rawText.slice(0, 300)}...`;
      }
      console.error('JSON 解析失敗:', rawText);
      return;
    }
    
    // 彈性處理資料格式：優先讀取 "Questions" 屬性 (對應教師端設定)
    const questions = Array.isArray(data) ? data : (data.Questions || data.questions || data.data);

    if (Array.isArray(questions)) {
      quizQuestions.value = questions.map((q, idx) => {
        // 強健的選項解析：處理字串、JSON 字串或陣列
        let rawOptions = q.options || q.Options || [];
        let parsedOptions = [];
        if (Array.isArray(rawOptions)) {
          parsedOptions = rawOptions;
        } else if (typeof rawOptions === 'string' && rawOptions.trim() !== '') {
          try {
            parsedOptions = JSON.parse(rawOptions);
          } catch (e) {
            // 如果不是 JSON，則視為逗號分隔字串
            parsedOptions = rawOptions.split(',').map(s => s.trim());
          }
        }

        return {
          ...q,
          id: q.id || `q-${idx}`,
          question: q.question || q.Question || '題目內容載入失敗',
          options: parsedOptions,
          answer: q.answer !== undefined ? q.answer : q.Answer,
        // 初始化作答區：多選為陣列，其餘為 null
        userAnswer: q.type === 'multiple' ? [] : null
        };
      });
    } else {
      errorMessage.value = '資料載入成功，但內容格式不符';
      errorDetail.value = `從 GAS 接收到的原始資料：\n${JSON.stringify(data, null, 2)}`;
    }
  } catch (error) {
    // 當 CORS 發生時，fetch 會拋出 TypeError: Failed to fetch
    console.error('讀取題目時發生錯誤 (可能為 CORS 或網路問題):', error);
    errorMessage.value = error.name === 'TypeError' ? '網路請求失敗 (可能是 CORS 阻擋)' : '程式執行發生異常';
    errorDetail.value = `錯誤訊息: ${error.message}\n\n目標網址: ${QUIZ_URL}\n\n堆疊資訊:\n${error.stack}`;

    alert(
      `無法載入題目。\n\n` +
      `常見原因：\n` +
      `1. GAS 部署時「誰可以存取」未設定為「任何人」。\n` +
      `2. GAS 程式碼出錯，導致回傳了錯誤網頁而非 JSON。`
    );
  } finally {
    isLoading.value = false;
  }
};

// --- 輔助函式：轉換題型文字 ---
const getQuestionTypeLabel = (type) => {
  const labels = {
    'single': '單選',
    'multiple': '多選',
    'boolean': '是非',
    'poll': '選項投票',
    'qa': '簡答回饋',
    'short_answer': '簡答',
    'shortanswer': '簡答'
  };
  return labels[type] || '未知';
};

// --- 2. 提交成績 (Submit Results) ---
const submitExam = async () => {
  if (!studentName.value.trim()) {
    return alert('請先輸入姓名再提交');
  }

  // 檢查是否有題目未作答
  if (quizQuestions.value.some(q => q.userAnswer === null || (Array.isArray(q.userAnswer) && q.userAnswer.length === 0))) {
    if(!confirm('還有題目沒寫完，確定要提交嗎？')) return;
  }

  // A. 計算分數
  let correctCount = 0;
  let scoreableCount = 0; // 僅統計有標準答案的題目

  quizQuestions.value.forEach(q => {
    // 投票題 (poll) 與 簡答題 (qa/short_answer) 不計入分數
    const isScoreable = ['single', 'multiple', 'boolean'].includes(q.type);
    if (!isScoreable) return;

    scoreableCount++;

    if (q.type === 'multiple') {
      // 確保答案與使用者作答皆為陣列且內容一致
      const isCorrect = Array.isArray(q.userAnswer) && 
                        Array.isArray(q.answer) &&
                        q.userAnswer.length === q.answer.length &&
                        q.userAnswer.every(val => q.answer.map(Number).includes(Number(val)));
      if (isCorrect) correctCount++;
    } else {
      // 單選與是非題：使用非嚴格相等或轉型比較，防止 GAS 傳回字串索引導致的錯誤
      if (String(q.userAnswer) === String(q.answer)) correctCount++;
    }
  });

  // 計算最終分數，若無計分題則預設為 100
  finalScore.value = scoreableCount > 0 
    ? Math.round((correctCount / scoreableCount) * 100)
    : 100;

  // B. 準備傳送給教師端的資料 (合併摘要與詳細作答)
  const submissionData = {
    action: 'submitFullResults', // 建議在 GAS 增加一個處理合併資料的 action
    name: studentName.value,
    score: finalScore.value,
    timestamp: new Date().toLocaleString('zh-TW', { hour12: false }), // 使用本地時間格式
    answers: quizQuestions.value.map(q => ({
      id: q.id,
      type: q.type,
      question: q.question, // 包含題目文本，方便後端識別
      userAnswer: q.userAnswer
    }))
  };

  try {
    await fetch(QUIZ_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submissionData)
    });

    // 由於 no-cors 無法讀取 response.ok，我們直接假設發送成功
    isSubmitted.value = true;
    alert(`提交成功！你的得分是：${finalScore.value}`);
    
  } catch (error) {
    console.error('提交成績出錯:', error);
    alert('成績上傳失敗，請檢查網路連線');
    // 這裡可以根據需要判斷是哪個請求失敗，給出更精確的提示
  }
};

// --- 獲取投票結果統計 ---
const fetchPollResults = async (pollId) => {
  try {
    const response = await fetch(`${POLL_URL}?action=getPollResults&pollId=${encodeURIComponent(pollId)}&_t=${Date.now()}`, {
      method: 'GET',
      redirect: 'follow'
    });
    if (!response.ok) return;
    
    const data = await response.json();
    if (data && data.status === 'success') {
      // data 格式預期為: { status: 'success', results: { '選項A': 5, '選項B': 3 }, total: 8 }
      pollResults.value[pollId] = data;
    }
  } catch (error) {
    console.error('獲取投票結果失敗:', error);
  }
};

// --- 3. 投票與回饋邏輯 (Polls & Feedback) ---
const fetchActivePoll = async () => {
  if (currentTab.value === 'poll' && activePolls.value.length === 0) isPollLoading.value = true;
  pollErrorMessage.value = '';
  
  try {
    const response = await fetch(`${POLL_URL}?action=getLatestPoll&cache_bust=${Date.now()}`, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store'
    });

    if (!response.ok) throw new Error('網路連線不正常');

    const rawText = await response.text();
    console.log('投票與回饋原始回傳:', rawText);

    // 1. 檢查是否為 HTML (代表 GAS 權限問題或部署版本未更新)
    const trimmedText = rawText.trim();
    if (trimmedText.startsWith('<!DOCTYPE') || trimmedText.startsWith('<html')) {
        // 嘗試抓取 HTML 標題以判斷錯誤類型 (例如: "Google Drive - 找不到檔案" 或 "Google 帳戶")
        const titleMatch = trimmedText.match(/<title>(.*?)<\/title>/i);
        const htmlTitle = titleMatch ? titleMatch[1] : '未知 HTML 頁面';
        
        pollErrorMessage.value = '後端權限或部屬錯誤';
        pollErrorDetail.value = `偵測到網頁回應：[${htmlTitle}]\n\n這通常代表 GAS 程式碼執行出錯或權限不足。\n\n修復檢查清單：\n1. 打開 GAS 編輯器左側的「執行情形」，查看具體錯誤日誌。\n2. 檢查程式碼中是否有 "&gt;" 或 "&lt;"，請改回 ">" 或 "<"。\n3. 重新部署：選擇【管理部署】->【編輯】->【新版本】->【部署】。\n4. 確保「誰可以存取」設定為【所有人】。`;
      activePolls.value = [];
      isPollLoading.value = false;
      return;
    }

    // 處理空資料情況
    if (!trimmedText || trimmedText === '{}' || trimmedText === 'null' || trimmedText === '[]') {
      activePolls.value = [];
      isPollLoading.value = false;
      return;
    }

    let data;
    try {
      data = JSON.parse(rawText);

      // 檢查投票與回饋後端是否回傳錯誤
      if (data && data.status === 'error') {
        pollErrorMessage.value = '投票與回饋 API 異常';
        pollErrorDetail.value = data.message;
        return;
      }
    } catch (e) {
      console.error('投票與回饋 JSON 解析失敗:', rawText);
      pollErrorMessage.value = '解析 JSON 失敗';
      pollErrorDetail.value = `收到內容：${rawText.slice(0, 100)}...`;
      return;
    }

    // 2. 提取題目列表 (支援陣列或單一物件)
    let pollsToProcess = [];
    if (data && typeof data === 'object') {
      const inner = data.poll || data.activePoll || data.data || data.Questions || data.questions;
      if (Array.isArray(inner)) pollsToProcess = inner;
      else if (Array.isArray(data)) pollsToProcess = data;
      else if (inner && (inner.question || inner.Question || inner.content)) pollsToProcess = [inner];
      else if (data.question || data.Question || data.content) pollsToProcess = [data];
    }

    // 格式化題目並過濾無效資料
    const processedPolls = pollsToProcess.map(rawData => {
      const question = rawData.question || rawData.Question || rawData.content || rawData.text || rawData.title || rawData.Item;
      const id = String(rawData.id || rawData.Id || rawData.ID || rawData.pollId || question || '');
      const type = (rawData.type || rawData.Type || 'single').toLowerCase().replace(/\s+/g, '_');
      const options = rawData.options || rawData.Options || [];

      let parsedOptions = [];
      if (Array.isArray(options)) {
        parsedOptions = options;
      } else if (typeof options === 'string' && options.trim() !== '') {
        try { parsedOptions = JSON.parse(options); } 
        catch (e) { parsedOptions = options.split(',').map(s => s.trim()); }
      }

      return { id, question, type, options: parsedOptions };
    }).filter(p => p.question);

    // 更新題目列表
    activePolls.value = processedPolls;

    // 讀取本地已提交的題目紀錄
    const localSubmissions = JSON.parse(localStorage.getItem('poll_submissions') || '{}');
    const localAnswers = JSON.parse(localStorage.getItem('poll_answers') || '{}');

    // 初始化每題的作答與提交狀態 (如果尚未存在)
    processedPolls.forEach(p => {
      if (pollAnswers.value[p.id] === undefined) {
        // 優先從本地儲存讀取答案，若無則初始化
        if (localAnswers[p.id] !== undefined) {
          pollAnswers.value[p.id] = localAnswers[p.id];
        } else if (p.type === 'multiple') {
          pollAnswers.value[p.id] = [];
        } else if (['short_answer', 'shortanswer', 'qa'].includes(p.type)) {
          pollAnswers.value[p.id] = '';
        } else {
          pollAnswers.value[p.id] = null;
        }
      }
      if (pollSubmissions.value[p.id] === undefined) {
        pollSubmissions.value[p.id] = !!localSubmissions[p.id];
      }
    });

    // 如果有已提交的題目，順便抓取統計結果
    processedPolls.forEach(p => {
      if (pollSubmissions.value[p.id]) fetchPollResults(p.id);
    });

    if (processedPolls.length === 0) {
      activePolls.value = [];
    }
  } catch (error) {
    console.error('[ERROR] 輪詢失敗:', error);
    pollErrorMessage.value = '網路請求失敗';
    pollErrorDetail.value = error.message;
  } finally {
    isPollLoading.value = false;
  }
};

// 輔助函式：將投票答案轉為易讀文字
const getPollDisplayAnswer = (poll) => {
  const answer = pollAnswers.value[poll.id];
  if (answer === undefined || answer === null || answer === '') return '未填答';
  
  if (poll.type === 'boolean') return answer === true ? '正確 (O)' : '錯誤 (X)';
  if (poll.type === 'single' || poll.type === 'poll') {
    return typeof answer === 'number' ? (poll.options[answer] || answer) : answer;
  }
  if (poll.type === 'multiple') {
    return Array.isArray(answer) ? answer.map(idx => typeof idx === 'number' ? (poll.options[idx] || idx) : idx).join(', ') : answer;
  }
  return answer;
};

const submitPoll = async (poll) => {
  if (!studentName.value.trim()) return alert('請先輸入姓名');
  
  const answer = pollAnswers.value[poll.id];
  const isEmpty = answer === null || 
                 (Array.isArray(answer) && answer.length === 0) ||
                 (typeof answer === 'string' && answer.trim() === '');

  if (isEmpty) {
    return alert('請填寫答案或選擇選項');
  }

  // 轉換答案為易讀的文字格式，方便老師在試算表檢視
  let displayAnswer = '';
  if (poll.type === 'boolean') {
    displayAnswer = answer === true ? '正確 (O)' : 
                    answer === false ? '錯誤 (X)' : '';
  } else if (poll.type === 'single' || poll.type === 'poll') {
    // 如果是索引（數字）則抓取選項文字，如果是字串則直接使用
    displayAnswer = typeof answer === 'number' 
      ? poll.options[answer] 
      : (answer || '');
  } else if (poll.type === 'multiple') {
    displayAnswer = (Array.isArray(answer) && answer.length > 0)
      ? answer.map(idx => typeof idx === 'number' ? (poll.options[idx] || idx) : idx).join(', ')
      : '';
  } else {
    displayAnswer = answer || '';
  }

  const pollData = {
    action: 'submitPoll',
    name: studentName.value,
    timestamp: new Date().toLocaleString('zh-TW', { hour12: false }), // 確保時間格式統一
    pollId: poll.id,
    question: poll.question,
    answer: displayAnswer
  };

  try {
    await fetch(POLL_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pollData)
    });
    pollSubmissions.value[poll.id] = true;
    fetchPollResults(poll.id); // 提交後立即抓取一次結果
    
    // 更新本地儲存的提交狀態
    const localSubmissions = JSON.parse(localStorage.getItem('poll_submissions') || '{}');
    localSubmissions[poll.id] = true;
    localStorage.setItem('poll_submissions', JSON.stringify(localSubmissions));
    
    // 同步儲存答案數值
    const localAnswers = JSON.parse(localStorage.getItem('poll_answers') || '{}');
    localAnswers[poll.id] = answer;
    localStorage.setItem('poll_answers', JSON.stringify(localAnswers));

    alert(`「${poll.question}」已提交成功！`);
  } catch (error) {
    alert('提交失敗');
  }
};

// 處理修改答案：同時更新 Vue 狀態與本地儲存
const modifyPoll = (pollId) => {
  pollSubmissions.value[pollId] = false;
  const localSubmissions = JSON.parse(localStorage.getItem('poll_submissions') || '{}');
  delete localSubmissions[pollId];
  localStorage.setItem('poll_submissions', JSON.stringify(localSubmissions));
  
  const localAnswers = JSON.parse(localStorage.getItem('poll_answers') || '{}');
  delete localAnswers[pollId];
  localStorage.setItem('poll_answers', JSON.stringify(localAnswers));
};

onMounted(() => {
  loadQuiz();
  // 初始化輪詢投票與回饋 (每 10 秒檢查一次)
  fetchActivePoll();
  pollTimer = setInterval(fetchActivePoll, 10000);
});

// 清除計時器
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="quiz-container">
    <header>
      <h1>{{ title }}</h1>
    </header>

    <!-- 分頁切換器 -->
    <nav class="tab-nav">
      <button :class="{ active: currentTab === 'quiz' }" @click="currentTab = 'quiz'">
        一般測驗
      </button>
      <button :class="{ active: currentTab === 'poll' }" @click="currentTab = 'poll'">
        投票與回饋 
        <span v-if="activePolls.length > 0 && activePolls.some(p => !pollSubmissions[p.id])" class="poll-badge">●</span>
      </button>
    </nav>

    <main>
      <!-- 1. 一般測驗區塊 -->
      <div v-if="currentTab === 'quiz'">
        <div v-if="isLoading" class="loading-state">載入題目中...</div>

        <div v-else-if="errorMessage" class="error-debug-container">
        <h3>❌ 載入失敗 (除錯資訊)</h3>
        <p class="error-msg">{{ errorMessage }}</p>
        <pre class="error-detail">{{ errorDetail }}</pre>
        <button @click="loadQuiz" class="retry-btn" style="margin-top: 15px;">重試載入題目</button>
      </div>

      <div v-else-if="!isSubmitted">
        <!-- 沒題目時的顯示狀態 -->
        <div v-if="quizQuestions.length === 0" class="empty-notice">
          <p>尚未有測驗題目，請等待老師出題。</p>
          <button @click="loadQuiz" class="retry-btn" style="margin-top: 15px; width: auto; padding: 10px 30px;">
            點此重新載入題目
          </button>
        </div>

        <div v-else>
          <div class="student-info">
            <label>您的姓名：</label>
            <input v-model="studentName" type="text" placeholder="請輸入姓名" class="name-input">
          </div>

          <!-- 進度條 -->
          <div class="progress-container">
            <div class="progress-text">作答進度：{{ progressPercentage }}%</div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" :style="{ width: progressPercentage + '%' }"></div>
            </div>
          </div>

          <section v-for="(q, index) in quizQuestions" :key="q.id + '-' + index" class="question-card">
            <p class="question-text">{{ index + 1 }}. {{ q.question }}</p>
            <div class="type-badge-row">{{ getQuestionTypeLabel(q.type) }}</div>
            <div class="options">
              <!-- 單選題 -->
              <template v-if="q.type === 'single' || q.type === 'poll'">
                <label v-for="(opt, optIdx) in q.options" :key="optIdx" class="option-item">
                  <input type="radio" :name="'q'+q.id" :value="q.type === 'poll' ? opt : optIdx" v-model="q.userAnswer">
                  {{ opt }}
                </label>
              </template>

              <!-- 簡答題 (包含多種鍵名相容) -->
              <template v-else-if="['short_answer', 'shortanswer', 'qa'].includes(q.type)">
                <textarea v-model="q.userAnswer" placeholder="請在此輸入您的回答..." class="poll-textarea"></textarea>
              </template>

              <!-- 多選題 -->
              <template v-else-if="q.type === 'multiple'">
                <label v-for="(opt, optIdx) in q.options" :key="optIdx" class="option-item">
                  <input type="checkbox" :value="optIdx" v-model="q.userAnswer">
                  {{ opt }}
                </label>
              </template>

              <!-- 是非題 -->
              <template v-else-if="q.type === 'boolean'">
                <label class="option-item">
                  <input type="radio" :name="'q'+q.id" :value="true" v-model="q.userAnswer"> 正確 (O)
                </label>
                <label class="option-item">
                  <input type="radio" :name="'q'+q.id" :value="false" v-model="q.userAnswer"> 錯誤 (X)
                </label>
              </template>
            </div>
          </section>

          <button 
            @click="submitExam" 
            class="submit-btn" 
            :class="{ 'pulse-btn': progressPercentage === 100 }"
            :disabled="!studentName.trim()"
          >
            提交測驗
          </button>
        </div>
      </div>

      <div v-else class="result-card">
        <h2>測驗完成</h2>
        <p class="score-display">您的得分：<span>{{ finalScore }}</span></p>
        <button @click="isSubmitted = false; loadQuiz()" class="retry-btn">重新作答</button>
      </div>
      </div>

      <!-- 2. 投票與回饋區塊 -->
      <div v-else-if="currentTab === 'poll'" class="poll-view">
        <div v-if="isPollLoading" class="loading-state">檢查即時題目中...</div>
        
        <div v-else-if="pollErrorMessage" class="error-debug-container">
          <h3>⚠️ 同步失敗</h3>
          <p class="error-msg">{{ pollErrorMessage }}</p>
          <div class="error-detail-wrapper">
            <pre class="error-detail">{{ pollErrorDetail }}</pre>
          </div>
          <button @click="fetchActivePoll" class="retry-btn">手動重試同步</button>
        </div>

        <div v-else>
        <div class="student-info">
          <label>您的姓名：</label>
          <input v-model="studentName" type="text" placeholder="請輸入姓名" class="name-input">
        </div>

        <div v-if="activePolls.length === 0" class="empty-notice">
          <p>目前沒有進行中的投票與回饋。</p>
          <p style="font-size: 0.9rem; color: #999;">(系統會自動更新，請稍候)</p>
          <button @click="fetchActivePoll" class="retry-btn" style="margin-top: 15px; width: auto; padding: 10px 20px;">
            手動刷新
          </button>
        </div>

        <div v-else>
          <div v-for="poll in activePolls" :key="poll.id">
            <!-- 已提交狀態 -->
            <div v-if="pollSubmissions[poll.id]" class="result-card" style="margin-bottom: 20px;">
              <h3 class="poll-result-title">{{ poll.question }}</h3>
              
              <div class="user-answer-box">
                <span class="user-answer-label">您的回答：</span>
                <span class="user-answer-text">{{ getPollDisplayAnswer(poll) }}</span>
              </div>
              
              <!-- 顯示即時統計結果 -->
              <div v-if="pollResults[poll.id]" class="poll-results-display">
                <div v-for="(count, label) in pollResults[poll.id].results" :key="label" class="result-bar-item">
                  <div class="result-bar-info">
                    <span class="result-bar-label">{{ label }}</span>
                    <span class="result-bar-count">{{ count }} 票 ({{ Math.round((count / pollResults[poll.id].total) * 100) || 0 }}%)</span>
                  </div>
                  <div class="result-bar-bg">
                    <div class="result-bar-fill" :style="{ width: (count / pollResults[poll.id].total * 100) + '%' }"></div>
                  </div>
                </div>
                <p class="total-votes-tag">{{ pollResults[poll.id].total }}</p>
              </div>
              <p v-else class="loading-results">正在載入統計結果...</p>

              <button @click="modifyPoll(poll.id)" class="retry-btn" style="margin-top: 15px; width: auto; padding: 10px 20px;">
                修改答案
              </button>
            </div>

            <!-- 作答區塊 -->
            <div v-else class="question-card">
              <p class="question-text">{{ poll.question }}</p>
              <div class="type-badge-row">{{ getQuestionTypeLabel(poll.type) }}</div>
              
              <div class="options">
                <!-- 單選題 / 選項投票 -->
                <template v-if="poll.type === 'single' || poll.type === 'poll'">
                  <label v-for="(opt, optIdx) in poll.options" :key="optIdx" class="option-item">
                    <input type="radio" :name="'poll-opt-'+poll.id" :value="poll.type === 'poll' ? opt : optIdx" v-model="pollAnswers[poll.id]">
                    {{ opt }}
                  </label>
                </template>

                <!-- 是非題 -->
                <template v-else-if="poll.type === 'boolean'">
                  <label class="option-item">
                    <input type="radio" :name="'poll-opt-'+poll.id" :value="true" v-model="pollAnswers[poll.id]"> 正確 (O)
                  </label>
                  <label class="option-item">
                    <input type="radio" :name="'poll-opt-'+poll.id" :value="false" v-model="pollAnswers[poll.id]"> 錯誤 (X)
                  </label>
                </template>

                <!-- 多選題 -->
                <template v-else-if="poll.type === 'multiple'">
                  <label v-for="(opt, optIdx) in poll.options" :key="optIdx" class="option-item">
                    <input type="checkbox" :value="optIdx" v-model="pollAnswers[poll.id]">
                    {{ opt }}
                  </label>
                </template>

                <!-- 簡答題 -->
                <template v-if="['short_answer', 'shortanswer', 'qa'].includes(poll.type)">
                  <textarea v-model="pollAnswers[poll.id]" placeholder="請在此輸入您的回答..." class="poll-textarea"></textarea>
                </template>
              </div>

              <button @click="submitPoll(poll)" class="submit-btn" style="margin-top: 20px;" :disabled="!studentName.trim()">
                提交答案
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 確保整個應用程式容器佔滿螢幕 */
.quiz-container {
  width: 100%;
  min-height: 100vh;
  padding: 20px;
  font-family: Arial, sans-serif;
  color: #333;
  box-sizing: border-box;
  background-color: #f7fafc; /* 加入底色，提升大螢幕觀感 */
  display: flex;
  flex-direction: column;
  align-items: center;
}
header, .tab-nav, main {
  width: 100%;
  max-width: 1300px; /* 進一步提高寬度上限，適合大螢幕 */
}

header {
  text-align: center;
  margin-bottom: 20px;
}

.tab-nav {
  display: flex;
  background: #edf2f7;
  padding: 5px;
  border-radius: 12px;
  margin-bottom: 25px;
  justify-content: center;
}

.tab-nav button {
  flex: 1;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: #718096;
  border-radius: 8px;
  cursor: pointer;
  font-weight: bold;
  position: relative;
  transition: all 0.2s;
  font-size: 1rem;
}

.tab-nav button.active {
  background: #42b983;
  color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.poll-badge {
  color: #ff4d4f;
  position: absolute;
  top: 5px;
  right: 10px;
  font-size: 1.2rem;
  animation: blink 1s infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

@keyframes pulse-red {
  0% { opacity: 1; }
  50% { opacity: 0.7; }
  100% { opacity: 1; }
}

.question-card {
  background: white;
  padding: clamp(20px, 3vw, 40px); /* 隨螢幕大小調整內邊距 */
  border-radius: 16px;
  margin-bottom: 24px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

.question-text {
  font-weight: bold;
  /* 響應式字體：在手機上維持 1.1rem，在大螢幕則隨寬度放大，最高至 2rem 確保遠端可視 */
  font-size: clamp(1.1rem, 2.5vw, 2rem);
}

.type-badge-row {
  color: #42b983;
  font-size: 0.9rem;
  margin: 5px 0 10px 0;
  font-weight: 500;
}

.options {
  display: flex; /* 預設為單欄，適用於手機 */
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

/* 在平板或較大螢幕上顯示兩欄 */
@media (min-width: 768px) {
  .options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); /* 自動調整為兩欄或更多 */
    gap: 15px; /* 增加間距 */
  }
}

/* 在大螢幕（如教室電子白板）上顯示三欄 */
@media (min-width: 1200px) {
  .options {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); /* 自動調整為三欄或更多 */
  }
}

.student-info {
  margin-bottom: 24px;
  background: white;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}

.student-info label {
  display: block;
  font-weight: bold;
  margin-bottom: 8px;
  color: #555;
}

.name-input {
  width: 100%;
  padding: 12px;
  border: 2px solid #edf2f7;
  border-radius: 8px;
  font-size: 1rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.3s;
}

.name-input:focus {
  border-color: #42b983;
}

.poll-textarea {
  width: 100%;
  min-height: 120px;
  padding: 14px;
  border: 2px solid #edf2f7;
  border-radius: 12px;
  font-size: 1rem;
  box-sizing: border-box;
  resize: vertical;
  outline: none;
  transition: border-color 0.3s;
  font-family: inherit;
  line-height: 1.5;
}

.poll-textarea:focus {
  border-color: #42b983;
}

.option-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border: 2px solid #edf2f7;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s ease;
  background-color: #fff;
  user-select: none;
}

/* 進度條樣式 */
.progress-container {
  margin-bottom: 24px;
  background: white;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.progress-text {
  font-size: 0.9rem;
  margin-bottom: 8px;
  font-weight: bold;
  color: #42b983;
}
.progress-bar-bg {
  background-color: #edf2f7;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}
.progress-bar-fill {
  background-color: #42b983;
  height: 100%;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 投票結果進度條 */
.poll-results-display {
  margin: 20px 0;
  text-align: left;
}
.result-bar-item {
  margin-bottom: 15px;
}
.result-bar-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 0.95rem;
  font-weight: bold;
}
.result-bar-bg {
  background: #edf2f7;
  height: 24px;
  border-radius: 12px;
  overflow: hidden;
}
.result-bar-fill {
  background: linear-gradient(90deg, #42b983, #38a169);
  height: 100%;
  transition: width 1s ease-out;
}
.total-votes-tag {
  font-size: 0.85rem;
  color: #718096;
  text-align: right;
  margin-top: 10px;
}

.user-answer-box {
  background: #f0fff4;
  border: 1px solid #c6f6d5;
  padding: 12px;
  border-radius: 8px;
  margin: 15px 0;
  text-align: left;
}
.user-answer-label {
  color: #2f855a;
  font-weight: bold;
}
.user-answer-text {
  color: #276749;
}
.loading-results {
  color: #a0aec0;
  font-style: italic;
  margin: 20px 0;
}

.option-item:hover {
  border-color: #42b983;
  background-color: #f9fdfb;
}

/* 當內部的 input 被勾選時，改變整個標籤的樣式 */
.option-item:has(input:checked) {
  border-color: #42b983;
  background-color: #e7f3ed;
  box-shadow: 0 2px 6px rgba(66, 185, 131, 0.1);
}

.option-item input {
  margin-right: 12px;
  width: 18px;
  height: 18px;
  accent-color: #42b983; /* 統一 Checkbox 與 Radio 的主題顏色 */
}

.loading-state {
  text-align: center;
  padding: 100px 0;
  color: #666;
  font-weight: 500;
}

.error-debug-container {
  background-color: #fff;
  border-left: 5px solid #ff4d4f;
  border-radius: 12px;
  padding: 24px;
  margin: 20px 0;
  text-align: left;
}

.error-msg {
  color: #c53030;
  font-weight: bold;
  font-size: 1.1rem;
  margin-bottom: 12px;
}

.error-detail {
  background: #1a202c;
  color: #a0aec0;
  padding: 15px;
  border-radius: 4px;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow-y: auto;
}

.empty-notice {
  text-align: center;
  padding: 40px;
  color: #666;
  background: #f0f0f0;
  border-radius: 8px;
}

.submit-btn, .retry-btn {
  display: block;
  width: fit-content;
  min-width: 180px;
  margin: 20px auto;
  padding: 12px 32px;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 1.1rem;
  cursor: pointer;
}

.submit-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.pulse-btn {
  animation: pulse-effect 2s infinite;
  background-color: #38a169 !important; /* 滿分時變換成更深更顯眼的綠色 */
}

@keyframes pulse-effect {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(66, 185, 131, 0.7);
  }
  70% {
    transform: scale(1.05);
    box-shadow: 0 0 0 12px rgba(66, 185, 131, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(66, 185, 131, 0);
  }
}

.result-card {
  text-align: center;
  padding: 40px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.1);
}

.score-display span {
  font-size: 2.5rem;
  color: #42b983;
  font-weight: bold;
}

/* 響應式調整 */
@media (max-width: 600px) {
  h1 {
    font-size: 1.4rem;
  }
}
</style>
