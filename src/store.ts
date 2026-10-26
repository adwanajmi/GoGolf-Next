import { createDemoData, type AppData } from './domain'

const STORAGE_KEY = 'gogolf-next-demo-v1'

export function loadData(): AppData {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as AppData
      if (parsed.bookings && parsed.scores && parsed.posts && parsed.prices && parsed.blockedSlots) {
        return parsed
      }
    }
  } catch {
    // A private browser session can deny storage; the demo still works in memory.
  }
  return createDemoData()
}

export function saveData(data: AppData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Keep the current session usable if browser storage is unavailable.
  }
}

export function resetData(): AppData {
  const data = createDemoData()
  saveData(data)
  return data
}
