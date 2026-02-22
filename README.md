# Status Page

A personal status page that displays your current priorities and workload. Features a dynamic "mood" indicator based on task count and weighted risk/urgency/importance, plus a **Flowkeeper** widget for maintaining flow-state through everyday task completion.

## Features

- **Public View**: Shows generalized task categories without exposing private task names
- **Private Edit Mode**: Password-protected editing with full task details
- **Dynamic Mood**: Visual stress indicator (Calm → Busy → Very Busy → Under Pressure)
- **Load Meter**: Segmented bar showing individual task contributions
- **Flowkeeper**: Minimal task widget with a flow-state meter (see below)
- **Cursor & Anthropic Usage**: Live animated token and line-of-code counters
- **Cyberpunk Aesthetic**: Neon colors, 3D perspective background, smooth animations
- **Mobile Optimized**: Responsive design with lighter-weight graphics for mobile

## Setup

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file:
   ```
   EDIT_PASSWORD=your_secret_password
   CURSOR_API_KEY=your_cursor_api_key          # optional
   ANTHROPIC_ADMIN_KEY=sk-ant-admin01-...      # optional
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

### Production (Vercel)

1. Deploy to Vercel
2. Add environment variables in Vercel dashboard:
   - `EDIT_PASSWORD` — password for edit mode
   - `CURSOR_API_KEY` — Cursor Teams API key (for usage stats)
   - `ANTHROPIC_ADMIN_KEY` — Anthropic Admin API key (for usage stats)
   - `BLOB_READ_WRITE_TOKEN` — auto-added when connecting a Vercel Blob store
3. Create a Vercel Blob store and connect it to your project

## Data Storage

- **Local**: JSON files in `data/` (`priorities.json`, `tags.json`, `flowkeeper.json`, `flow-completions.json`, `cursor-usage.json`)
- **Production**: Vercel Blob storage for persistence

## How It Works

### Attention Meter (Mood Calculation)

Tasks are weighted by their Risk, Urgency, and Importance (1-3 scale each):
- Weight multipliers: Low = 0.5, Medium = 1.5, High = 3.0
- Weight = risk_weight + urgency_weight + importance_weight
- Total load determines mood: < 15 = Calm, < 35 = Busy, ≥ 35 = Under Pressure

### Flowkeeper

Flowkeeper is a separate, minimal widget for tracking everyday tasks that maintain your flow-state. Unlike priorities, Flowkeeper tasks are simple (just a label and difficulty) and do **not** contribute to the attention meter.

**How flow-state works:**

Completing a task grants a percentage of flow for a duration based on difficulty:

| Difficulty | Flow granted | Duration |  Example tasks              |
|------------|-------------|----------|-----------------------------|
| Easy (1)   | 33%         | 4 hours  | Go for a run, do the dishes |
| Medium (2) | 43%         | 8 hours  | Mow the lawn, clean garage  |
| Hard (3)   | 53%         | 12 hours | Pull the weeds, deep clean  |

- Flow stacks from multiple completions up to 100%
- As completions expire, flow decays automatically
- Two medium tasks (86%) or one hard + one easy (86%) nearly max the meter
- The flow meter is displayed as a translucent blue bar above the attention meter

**Authentication is required** to add, edit, complete, or delete Flowkeeper tasks.

### Privacy

- Private task labels are **never** sent to unauthenticated users
- Public view only shows generalized tags (e.g., "Programming - New Features")
- Flowkeeper task labels are publicly visible (they are intended to be simple everyday tasks)
- Authentication uses Bearer token in Authorization header

## Tech Stack

- Next.js (App Router)
- React
- Tailwind CSS v4
- Vercel Blob (production storage)

## License

MIT
