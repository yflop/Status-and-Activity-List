# Status Page

A personal status page that displays your current priorities and workload. Features a dynamic "mood" indicator based on task count and weighted risk/urgency/importance.

## Features

- **Public View**: Shows generalized task categories without exposing private task names
- **Private Edit Mode**: Password-protected editing with full task details
- **Dynamic Mood**: Visual stress indicator (Calm → Busy → Very Busy → Under Pressure)
- **Load Meter**: Segmented bar showing individual task contributions
- **Cyberpunk Aesthetic**: Neon colors, 3D perspective background, smooth animations
- **Mobile Optimized**: Responsive design with lighter-weight graphics for mobile

## Setup

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file with your edit password:
   ```
   EDIT_PASSWORD=your_secret_password
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

### Production (Vercel)

1. Deploy to Vercel
2. Add environment variable `EDIT_PASSWORD` in Vercel dashboard
3. Create a Vercel Blob store and connect it to your project
4. Add the `BLOB_READ_WRITE_TOKEN` environment variable (auto-added when connecting Blob)

## Data Storage

- **Local**: Uses `data/priorities.json` and `data/tags.json`
- **Production**: Uses Vercel Blob storage for persistence

## How It Works

### Mood Calculation

Tasks are weighted by their Risk, Urgency, and Importance (1-3 scale each):
- Weight = (Risk × 1.5) + (Urgency × 1.2) + (Importance × 1.0)
- Total load determines mood thresholds

### Privacy

- Private task labels are **never** sent to unauthenticated users
- Public view only shows generalized tags (e.g., "Programming - New Features")
- Authentication uses Bearer token in Authorization header

## Tech Stack

- Next.js 14 (App Router)
- React
- Tailwind CSS
- Vercel Blob (production storage)

## License

MIT
