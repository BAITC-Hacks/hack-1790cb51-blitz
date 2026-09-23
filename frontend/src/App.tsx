import { useEffect, useState } from 'react'

function App() {
  const [status, setStatus] = useState('Проверяем API…')

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then(() => setStatus('API подключён'))
      .catch(() => setStatus('API недоступен'))
  }, [])

  return (
    <main>
      <section>
        <p className="eyebrow">Blitz Hackathon</p>
        <h1>React + Python</h1>
        <p>Базовая структура проекта готова.</p>
        <span className="status">{status}</span>
      </section>
    </main>
  )
}

export default App
