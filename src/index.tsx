import { Hono } from 'hono'
import { agentsMiddleware } from 'hono-agents'

export { RestaurantAgent } from './agent'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.use('/agents/*', agentsMiddleware())

export default app
