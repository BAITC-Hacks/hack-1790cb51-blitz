import { Component, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty">
          <h1>Не удалось отобразить страницу</h1>
          <p>
            Сохранённые проекты остаются на сервере. Обновите страницу, чтобы продолжить работу.
          </p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </div>
      )
    return this.props.children
  }
}
