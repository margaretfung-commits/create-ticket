const express = require("express");
const axios = require("axios");
require("dotenv").config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const PORT = process.env.PORT || 3000;
app.post("/create-ticket", async (req, res) => {
  res.send("Processing..."); // ⚠️ Slack 要即刻回應
  const { channel_id, thread_ts } = req.body;
  try {
    // 1. 拉 Slack thread
    const threadRes = await axios.get("https://slack.com/api/conversations.replies", {
      params: {
        channel: channel_id,
        ts: thread_ts
      },
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
      }
    });
    const messages = threadRes.data.messages.map(m => m.text).join("\n");
    // 2. AI summary（先 mock）
    const summary = `Summary of issue:\n${messages.slice(0, 300)}`;
    // 3. Create Jira ticket
    const jiraRes = await axios.post(
      `${process.env.JIRA_BASE_URL}/rest/api/3/issue`,
      {
        fields: {
          project: { key: process.env.JIRA_PROJECT_KEY },
          summary: summary.substring(0, 100),
          description: summary,
          issuetype: { name: "Task" }
        }
      },
      {
        auth: {
          username: process.env.JIRA_EMAIL,
          password: process.env.JIRA_API_TOKEN
        },
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
    const ticketKey = jiraRes.data.key;
    const link = `${process.env.JIRA_BASE_URL}/browse/${ticketKey}`;
    // 4. 回覆 Slack
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: channel_id,
        thread_ts: thread_ts,
        text: `✅ Ticket created: ${ticketKey}\n🔗 ${link}`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error(err);
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: req.body.channel_id,
        thread_ts: req.body.thread_ts,
        text: "❌ Failed to create ticket"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  }
});
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
