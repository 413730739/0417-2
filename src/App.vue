<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

// 測驗卷資料與作答狀態
const title = ref('測驗卷')
const questions = ref([])
const userAnswers = ref({})
const isSubmitted = ref(false)
const score = ref(0)

// 模擬從教師端獲取題目 (實作時請更換為實際的 API Endpoint)
const fetchQuestions = async () => {
  try {
    // 注意：由於 GitHub Pages 是靜態網頁，通常會讀取其中的 JSON 檔案
    // 這裡假設教師端有一個 questions.json
    const response = await fetch('https://413730739.github.io/0417/questions.json')
    if (response.ok) {
      questions.value = await response.json()
    } else {
      // 測試用模擬資料
      questions.value = [
        { id: 1, text: 'Vue 是一種什麼類型的框架？', options: ['後端', '前端', '資料庫'], answer: '前端' },
        { id: 2, text: '響應式網頁主要是靠什麼技術達成？', options: ['CSS Media Queries', 'SQL', 'C++'], answer: 'CSS Media Queries' }
      ]
    }
  } catch (error) {
    console.error('無法獲取題目:', error)
  }
}

// 提交答案並上傳成績
const submitQuiz = async () => {
  let correctCount = 0
  questions.value.forEach(q => {
    if (userAnswers.value[q.id] === q.answer) {
      correctCount++
    }
  })
  
  score.value = Math.round((correctCount / questions.value.length) * 100)
  isSubmitted.value = true

  // 上傳成績到教師端統計 (需有後端 API 支援)
  try {
    await fetch('https://your-api-server.com/api/submit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: 'Student_001', // 可加入學生編號
        score: score.value,
        timestamp: new Date().toISOString()
      })
    })
    alert('成績已上傳至教師端！')
  } catch (error) {
    console.warn('成績上傳失敗（需實作後端接收端）:', error)
  }
}

let timer = null

onMounted(() => {
  fetchQuestions()
  // 若需「及時」出現，可使用 setInterval 輪詢或 WebSocket
  timer = setInterval(fetchQuestions, 30000) // 每 30 秒更新一次題目
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="quiz-container">
    <header>
      <h1>{{ title }}</h1>
    </header>

    <main>
      <div v-if="!isSubmitted">
        <section v-for="(q, index) in questions" :key="q.id" class="question-card">
          <p class="question-text">{{ index + 1 }}. {{ q.text }}</p>
          <div class="options">
            <label v-for="option in q.options" :key="option" class="option-item">
              <input type="radio" :name="'q'+q.id" :value="option" v-model="userAnswers[q.id]">
              {{ option }}
            </label>
          </div>
        </section>

        <button @click="submitQuiz" class="submit-btn" :disabled="questions.length === 0">
          提交測驗
        </button>
      </div>

      <div v-else class="result-card">
        <h2>測驗完成</h2>
        <p class="score-display">您的得分：<span>{{ score }}</span></p>
        <button @click="isSubmitted = false; userAnswers = {}" class="retry-btn">重新作答</button>
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

.option-item {
  cursor: pointer;
  padding: 5px;
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
