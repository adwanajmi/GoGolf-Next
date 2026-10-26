import { createApp } from './app.mjs'

const port = Number(process.env.GOGOLF_PORT || 8201)
const { server } = createApp()
server.listen(port, '127.0.0.1', () => console.log(`GoGolf Next API http://127.0.0.1:${port}`))
