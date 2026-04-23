const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Handle Message Shortcut ───────────────────────────────────────────────
app.post("/slack/shortcuts", async (req, res) => {
  // Slack sends payload as URL-encoded string
  const payload = JSON.parse(req.body.payload);

  // Must acknowledge within 3 seconds
  res.sendStatus(200);

  // Only handle our specific shortcut
  if (payload.callback_id !== "create_jira_ticket") return;

  const channelId = payload.channel.id;
  const threadTs = payload.message.thread_ts || payload.message.ts;

  try {
    // 1. Grab full thread history
    const threadRes = await axios.get("https://slack.com/api/conversations.replies", {
      params: {
        channel: channelId,
        ts: threadTs,
      },
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
    });

    if (!threadRes.data.ok) {
      throw new Error(`Slack API error: ${threadRes.data.error}`);
    }

    const messages = threadRes.data.messages
      .map((m) => `${m.username || "User"}: ${m.text}`)
      .join("\n");

    // 2. Use Claude AI to generate title + description
    const claudeRes = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `You are a Jira ticket writer specialising in Feature / Enhancement tickets. Based on the following Slack thread, generate a well-structured Jira ticket.
 
Respond in this exact JSON format with no extra text:
{
  "title": "A concise ticket title (max 100 characters)",
  "background": "Why this feature is needed. What problem or opportunity is being addressed.",
  "requirements": "A clear list of what needs to be built or changed. Be specific.",
  "acceptance_criteria": "A list of conditions that must be met for this ticket to be considered done.",
  "steps_to_reproduce": "If applicable, steps to reproduce the current behaviour or gap. Write N/A if not applicable."
}

Slack thread:
${messages}`,
          },
        ],
      },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      }
    );

    // Parse Claude response
    const rawText = claudeRes.data.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude did not return valid JSON");
    const { title, description } = JSON.parse(jsonMatch[0]);

    // 3. Create Jira ticket
    const jiraRes = await axios.post(
      `${process.env.JIRA_BASE_URL}/rest/api/3/issue`,
      {
        fields: {
          project: { key: process.env.JIRA_PROJECT_KEY },
          summary: title,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: description }],
              },
            ],
          },
          issuetype: { name: "Task" },
        },
      },
      {
        auth: {
          username: process.env.JIRA_EMAIL,
          password: process.env.JIRA_API_TOKEN,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const ticketKey = jiraRes.data.key;
    const link = `${process.env.JIRA_BASE_URL}/browse/${ticketKey}`;

    // 4. Reply in Slack thread with ticket link
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: channelId,
        thread_ts: threadTs,
        text: `✅ Jira ticket created!\n*${title}*\n🔗 ${link}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);

    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: channelId,
        thread_ts: threadTs,
        text: `❌ Failed to create ticket: ${err.message}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  }
});

// ─── Health check ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("SAP Ticket Bot is running!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
