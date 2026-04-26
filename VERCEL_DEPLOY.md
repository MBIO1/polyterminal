# Vercel Deployment Configuration
# Run these commands to deploy your dashboard

# Step 1: Install Vercel CLI globally
npm i -g vercel

# Step 2: Login to Vercel
vercel login

# Step 3: Link your project (run this in the polyterminal directory)
cd /Users/earn/.verdent/verdent-projects/how-connect-ssh/polyterminal
vercel link

# Step 4: Set environment variables
vercel env add VITE_BASE44_APP_ID
# Enter your Base44 App ID when prompted

vercel env add VITE_BASE44_APP_BASE_URL
# Enter: https://polytrade.base44.app

# Step 5: Deploy to production
vercel --prod

# Your dashboard will be live at: https://polytrade.vercel.app

# Optional: Set custom domain
# vercel domains add yourdomain.com
