<script setup>
import { ref, onMounted } from 'vue'

// --- 配置區 ---
// 請確保此處的 URL 與教師端設定的完全一致
// ⚠️ 重要：請確保這裡的網址與教師端 App.vue 中的 DATABASE_URL 完全相同
// 這是你部署的 Google Apps Script 網頁應用程式 URL
const DATABASE_URL = 'https://script.google.com/macros/s/AKfycbwuZPaq_YZGm0IIerf31-qGy4PctH8CoP006_k_rxd_jA3dNoPtFYjTRFOlCECy6_C9A/exec'; 

// --- 狀態管理 ---
const title = ref('測驗卷')
const quizQuestions = ref([]); // 儲存從教師端抓取的題目
const studentName = ref('');    // 學生姓名
const isSubmitted = ref(false); // 是否已提交
const finalScore = ref(0);      // 計算出的分數
const isLoading = ref(true);    // 載入狀態

// --- 1. 讀取題目 (Fetch Quiz) ---
const loadQuiz = async () => {
  isLoading.value = true;
  try {
    // 使用 Google Apps Script 的 GET 請求，並帶上 action 參數
    const response = await fetch(`${DATABASE_URL}?action=getQuiz&_t=${Date.now()}`); // 加上時間戳防止快取
    
    if (!response.ok) {
      // 如果 HTTP 狀態碼不是 2xx，則拋出錯誤
      throw new Error(`HTTP 錯誤: ${response.status} - 無法從 Google Apps Script 取得題目。`);
    }
    
    const data = await response.json();
    
    if (data && Array.isArray(data)) {
      quizQuestions.value = data.map(q => ({
        ...q,
        // 初始化作答區：多選為陣列，其餘為 null
        userAnswer: q.type === 'multiple' ? [] : null
      }));
    } else {
      quizQuestions.value = [];
      console.warn('目前資料庫中沒有題目，或資料格式不正確。');
    }
  } catch (error) {
    console.error('讀取題目失敗:', error);
    alert(`連線失敗: ${error.message}\n請確認 Google Apps Script 網址是否正確，且已部署為「所有人」可存取的網頁應用程式。`);
  } finally {
    isLoading.value = false;
  }
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
      const isCorrect = Array.isArray(q.userAnswer) && 
                        q.userAnswer.length === q.answer.length &&
                        q.userAnswer.every(val => q.answer.includes(val));
      if (isCorrect) correctCount++;
    } else {
      // 單選與是非題的答案是單一值 (索引或布林值)
      if (q.userAnswer === q.answer) correctCount++;
    }
  });

  finalScore.value = Math.round((correctCount / quizQuestions.value.length) * 100);

  // B. 準備傳送給教師端的資料
  const resultData = {
    action: 'submitScore', // 告知 Apps Script 這是提交成績的動作
    name: studentName.value,
    score: finalScore.value,
    timestamp: new Date().toLocaleString('zh-TW', { hour12: false }), // 使用本地時間格式
  };

  try {
    // 提交到 Google Script 的 doPost
    await fetch(DATABASE_URL, {
      method: 'POST',
      mode: 'no-cors', // 重要：Google Script 提交通常需要 no-cors
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultData)
    });

    // 由於 no-cors 無法讀取 response.ok，我們直接假設發送成功
    isSubmitted.value = true;
    alert(`提交成功！你的得分是：${finalScore.value}`);
    
  } catch (error) {
    console.error('提交成績出錯:', error);
    alert('成績上傳失敗，請檢查網路連線');
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

      <div v-else-if="!isSubmitted">
        <div class="student-info">
          <label>您的姓名：</label>
          <input v-model="studentName" type="text" placeholder="請輸入姓名" class="name-input">
        </div>

        <div v-if="quizQuestions.length === 0" class="empty-notice">
          目前尚未有測驗題目，請聯繫老師出題。
        </div>

        <section v-else v-for="(q, index) in quizQuestions" :key="q.id + '-' + index" class="question-card">
          <!-- 這裡使用 q.question 以對應教師端發佈的資料結構 -->
          <p class="question-text">{{ index + 1 }}. {{ q.question }}</p>
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

        <button v-if="quizQuestions.length > 0" @click="submitExam" class="submit-btn">
          提交測驗
        </button>
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
