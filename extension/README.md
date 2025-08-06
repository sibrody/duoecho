# DuoEcho - AI Conversation Memory

## 🚀 Quick Start (5 minutes)

### 1. Install the Extension

1. Open Chrome
2. Go to `chrome://extensions/`
3. Turn on "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `duoecho-extension` folder
6. You'll see the 🔄 icon in your toolbar!

### 2. Test It Out

1. Go to claude.ai and have a conversation
2. Click the DuoEcho icon
3. Click "Capture Conversation"
4. Download as markdown
5. Check your Downloads/duoecho folder

## ✨ What It Does

- **Captures** entire conversations from Claude, ChatGPT, and Lovable
- **Detects** decisions automatically
- **Scores** conversation quality
- **Exports** as markdown ready for your .ai-context folders

## 🎯 Decision Detection

The extension looks for patterns like:
- "Let's use..."
- "We'll implement..."
- "Decided to..."
- "DECISION:" (explicit marker)

## 📁 Save Location

Downloads to: `Downloads/duoecho/[project]-[platform]-[date].md`

Then move to: `~/Dev/SolOS/solos-mvp/apps/[project]/.ai-context/sessions/`

## 🔮 Coming This Weekend

- [ ] GitHub direct save
- [ ] Auto-capture when decisions detected
- [ ] Pattern learning (your style)
- [ ] Conversation search
- [ ] Quality insights

## 🐛 Troubleshooting

If the extension doesn't work:
1. Make sure you're on claude.ai, chat.openai.com, or lovable.dev
2. Refresh the page after installing
3. Check the console for errors (F12)

## 💡 Pro Tips

1. Mark important decisions with "DECISION:" for 100% detection
2. The quality score tracks conversation depth
3. Project detection is automatic based on keywords

---

Built with ❤️ for AI-assisted developers
