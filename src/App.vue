<script setup>
import { ref, onMounted } from 'vue'

// --- 配置區 ---
// 請確保此處的 URL 與教師端設定的完全一致
// ⚠️ 所有的請求（取得題目、提交成績、詳細作答）現在統一回傳至此網址
// 開發環境使用 Vite Proxy 解決 CORS 問題，生產環境則使用完整 GAS 網址
const QUIZ_URL = import.meta.env.DEV 
  ? '/api-quiz/exec' 
  : 'https://script.google.com/macros/s/AKfycbyR7t58ExcpPfuuEY6wPz4ctdJg_V9fQ0klVnopEHYnYvn-DF-OzL8YxJTtKCI1h5nvCQ/exec';

// --- 狀態管理 ---
const title = ref('測驗卷')
const quizQuestions = ref([]); // 儲存從教師端抓取的題目
const studentName = ref('');    // 學生姓名
const isSubmitted = ref(false); // 是否已提交
const finalScore = ref(0);      // 計算出的分數
const isLoading = ref(true);    // 載入狀態
const errorMessage = ref('');    // 錯誤簡述 (顯示於畫面)
const errorDetail = ref('');     // 詳細錯誤資訊 (除錯用)

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
    let data;
    try {
      data = JSON.parse(rawText);
      console.log('從 GAS 接收到的原始資料:', data);
    } catch (parseError) {
      if (rawText.includes('errorMessage') || rawText.includes('script-error')) {
        errorMessage.value = 'Google Apps Script 執行發生內部錯誤';
        errorDetail.value = '請檢查 GAS 端的「執行效能」日誌，通常是程式碼 Bug 或試算表權限問題。';
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
      quizQuestions.value = questions.map((q, idx) => ({
        ...q,
        // 確保關鍵欄位存在，並處理可能的大小寫欄位差異
        id: q.id || `q-${idx}`,
        question: q.question || q.Question || '題目內容載入失敗',
        options: q.options || q.Options || [],
        answer: q.answer !== undefined ? q.answer : q.Answer,
        // 初始化作答區：多選為陣列，其餘為 null
        userAnswer: q.type === 'multiple' ? [] : null
      }));
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
    'boolean': '是非'
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
  quizQuestions.value.forEach(q => {
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

  finalScore.value = Math.round((correctCount / quizQuestions.value.length) * 100);

  // B. 準備傳送給教師端的資料 (成績摘要)
  const scoreSummaryData = {
    action: 'submitResult', // 告知 Apps Script 這是提交成績的動作 (對齊 GAS 的 submitResult)
    name: studentName.value,
    score: finalScore.value,
    timestamp: new Date().toLocaleString('zh-TW', { hour12: false }), // 使用本地時間格式
  };

  // C. 準備傳送給教師端的資料 (詳細作答答案)
  const detailedAnswersData = {
    action: 'submitDetailedAnswers', // 新增一個 action 告知 GAS 這是詳細答案
    name: studentName.value,
    timestamp: new Date().toLocaleString('zh-TW', { hour12: false }),
    answers: quizQuestions.value.map(q => ({
      id: q.id,
      type: q.type,
      question: q.question, // 包含題目文本，方便後端識別
      userAnswer: q.userAnswer,
      // 如果後端需要，也可以包含正確答案：correctAnswer: q.answer
    }))
  };

  try {
    // 1. 提交成績摘要 (姓名、分數、時間) 到 QUIZ_URL
    await fetch(QUIZ_URL, {
      method: 'POST',
      mode: 'no-cors', // 重要：Google Script 提交通常需要 no-cors
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoreSummaryData)
    });

    // 2. 提交詳細作答資訊 (姓名、詳細答案、時間) 到 QUIZ_URL
    await fetch(QUIZ_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(detailedAnswersData)
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

onMounted(() => {
  loadQuiz();
});
</script>

<template>
  <div class="quiz-container">
    <header>
      <h1>{{ title }}</h1>
    </header>

    <main>
      <div v-if="isLoading" class="loading-state">載入題目中...</div>

      <!-- 除錯顯示區：當發生載入錯誤時顯示 -->
      <div v-else-if="errorMessage" class="error-debug-container">
        <h3>❌ 載入失敗 (除錯資訊)</h3>
        <p class="error-msg">{{ errorMessage }}</p>
        <pre class="error-detail">{{ errorDetail }}</pre>
        <button @click="loadQuiz" class="retry-btn" style="margin-top: 15px;">重試載入題目</button>
      </div>

      <div v-else-if="!isSubmitted">
        <!-- 沒題目時的顯示狀態 (修正 typo 偶蹄目 -> 有題目) -->
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

          <section v-for="(q, index) in quizQuestions" :key="q.id + '-' + index" class="question-card">
            <p class="question-text">{{ index + 1 }}. {{ q.question }}</p>
            <div class="type-badge-row">{{ getQuestionTypeLabel(q.type) }}</div>
            <div class="options">
              <!-- 單選題 -->
              <template v-if="q.type === 'single'">
                <label v-for="(opt, optIdx) in q.options" :key="optIdx" class="option-item">
                  <input type="radio" :name="'q'+q.id" :value="optIdx" v-model="q.userAnswer">
                  {{ opt }}
                </label>
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

          <button @click="submitExam" class="submit-btn">
            提交測驗
          </button>
        </div>
      </div>

      <div v-else class="result-card">
        <h2>測驗完成</h2>
        <p class="score-display">您的得分：<span>{{ finalScore }}</span></p>
        <button @click="isSubmitted = false; studentName = ''; loadQuiz()" class="retry-btn">重新作答</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.quiz-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
  color: #333;
}

header {
  text-align: center;
  border-bottom: 2px solid #42b983;
  margin-bottom: 30px;
}

h1 {
  color: #2c3e50;
}

.question-card {
  background: #f9f9f9;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.question-text {
  font-weight: bold;
  font-size: 1.1rem;
}

.type-badge-row {
  color: #42b983;
  font-size: 0.9rem;
  margin: 5px 0 10px 0;
  font-weight: 500;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.student-info {
  margin-bottom: 20px;
}

.name-input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  box-sizing: border-box;
  outline: none;
}

.option-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border: 2px solid #f0f0f0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.25s ease;
  background-color: #fff;
  user-select: none;
}

.option-item:hover {
  border-color: #42b983;
  background-color: #f0faf5;
}

/* 當內部的 input 被勾選時，改變整個標籤的樣式 */
.option-item:has(input:checked) {
  border-color: #42b983;
  background-color: #e7f3ed;
  box-shadow: 0 2px 8px rgba(66, 185, 131, 0.2);
}

.option-item input {
  margin-right: 12px;
  width: 18px;
  height: 18px;
  accent-color: #42b983; /* 統一 Checkbox 與 Radio 的主題顏色 */
}

.loading-state {
  text-align: center;
  padding: 50px;
  font-size: 1.2rem;
}

.error-debug-container {
  background-color: #fff5f5;
  border: 2px solid #feb2b2;
  border-radius: 8px;
  padding: 20px;
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
  width: 100%;
  padding: 12px;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
}

.submit-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.result-card {
  text-align: center;
  padding: 40px;
  background: #e7f3ed;
  border-radius: 12px;
}

.score-display span {
  font-size: 2.5rem;
  color: #42b983;
  font-weight: bold;
}

/* 響應式調整 */
@media (max-width: 600px) {
  .quiz-container {
    padding: 10px;
  }
  h1 {
    font-size: 1.5rem;
  }
}
</style>
