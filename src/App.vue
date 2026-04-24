<script setup>
import { ref, onMounted } from 'vue'

// --- 配置區 ---
// 請確保此處的 URL 與教師端設定的完全一致
const DATABASE_URL = 'https://YOUR-PROJECT-ID.firebaseio.com'; 

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
    const response = await fetch(`${DATABASE_URL}/quiz.json`);
    const data = await response.json();
    
    if (data) {
      // 初始化作答空間 (如果是多選題則初始化為陣列)
      quizQuestions.value = data.map(q => ({
        ...q,
        userAnswer: q.type === 'multiple' ? [] : null
      }));
    } else {
      console.log('目前沒有可用的測驗題目');
    }
  } catch (error) {
    console.error('讀取題目失敗:', error);
    alert('無法連線至題目伺服器');
  } finally {
    isLoading.value = false;
  }
};

// --- 2. 提交成績 (Submit Results) ---
const submitExam = async () => {
  if (!studentName.value.trim()) {
    return alert('請先輸入姓名再提交');
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
      if (q.userAnswer === q.answer) correctCount++;
    }
  });

  finalScore.value = Math.round((correctCount / quizQuestions.value.length) * 100);

  // B. 準備傳送給教師端的資料
  const resultData = {
    name: studentName.value,
    score: finalScore.value,
    timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    submitAt: new Date().toISOString()
  };

  try {
    // 使用 POST 方法將成績「新增」到 results 路徑
    const response = await fetch(`${DATABASE_URL}/results.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultData)
    });

    if (response.ok) {
      isSubmitted.value = true;
      alert(`提交成功！你的得分是：${finalScore.value}`);
    } else {
      throw new Error('提交失敗');
    }
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
          <input v-model="studentName" type="text" placeholder="請輸入姓名" class="name-input">
        </div>

        <section v-for="(q, index) in quizQuestions" :key="q.id + '-' + index" class="question-card">
          <p class="question-text">{{ index + 1 }}. {{ q.text }}</p>
          <div class="options">
            <template v-if="q.type !== 'multiple'">
              <label v-for="option in q.options" :key="option" class="option-item">
                <input type="radio" :name="'q'+q.id" :value="option" v-model="q.userAnswer">
                {{ option }}
              </label>
            </template>
            <template v-else>
              <label v-for="option in q.options" :key="option" class="option-item">
                <input type="checkbox" :value="option" v-model="q.userAnswer">
                {{ option }}
              </label>
            </template>
          </div>
        </section>

        <button @click="submitExam" class="submit-btn" :disabled="quizQuestions.length === 0">
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
  cursor: pointer;
  padding: 5px;
}

.loading-state {
  text-align: center;
  padding: 50px;
  font-size: 1.2rem;
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
