require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();

const DISCORD_API = 'https://discord.com/api/v10';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://melixbot.xyz';
const JWT_SECRET = process.env.JWT_SECRET || 'melix-dashboard-secret-change-me';
const STAFF_IDS = (process.env.STAFF_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500'],
  credentials: true
}));
app.use(express.json());

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/api/auth/login', (req, res) => {
  const scope = 'identify guilds';
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scope)}`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const tokenRes = await axios.post(`${DISCORD_API}/oauth2/token`,
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    const userRes = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const user = userRes.data;
    const isStaff = STAFF_IDS.includes(user.id);

    const dashboardToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        isStaff,
        accessToken: access_token
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const redirectTo = `${FRONTEND_URL}/dashboard/callback.html#token=${dashboardToken}`;
    res.redirect(redirectTo);

  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    res.status(500).json({ error: 'OAuth exchange failed' });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    discriminator: req.user.discriminator,
    avatar: req.user.avatar
      ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(req.user.discriminator || '0') % 5}.png`,
    isStaff: req.user.isStaff
  });
});

app.get('/api/guilds', authMiddleware, async (req, res) => {
  try {
    const guildsRes = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${req.user.accessToken}` }
    });

    const guilds = guildsRes.data;

    if (!BOT_TOKEN) {
      return res.json(guilds.map(g => ({
        ...g,
        iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        botInGuild: false
      })));
    }

    const botGuildsRes = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const botGuildIds = new Set(botGuildsRes.data.map(g => g.id));

    const enriched = guilds
      .filter(g => (parseInt(g.permissions) & 0x20) !== 0)
      .map(g => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        owner: g.owner,
        permissions: g.permissions,
        botInGuild: botGuildIds.has(g.id)
      }));

    res.json(enriched);
  } catch (err) {
    console.error('Guilds fetch error:', err.response?.data || err.message);
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Discord session expired, please re-login' });
    }
    res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

app.get('/api/guild/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!BOT_TOKEN) {
    return res.status(400).json({ error: 'Bot token not configured' });
  }

  try {
    const guildRes = await axios.get(`${DISCORD_API}/guilds/${id}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const guild = guildRes.data;

    const channelsRes = await axios.get(`${DISCORD_API}/guilds/${id}/channels`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    const rolesRes = await axios.get(`${DISCORD_API}/guilds/${id}/roles`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    const membersRes = await axios.get(`${DISCORD_API}/guilds/${id}/members?limit=100`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    res.json({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
      ownerId: guild.owner_id,
      memberCount: guild.approximate_member_count || membersRes.data.length,
      channels: channelsRes.data.map(c => ({ id: c.id, name: c.name, type: c.type })),
      roles: rolesRes.data.map(r => ({ id: r.id, name: r.name, color: r.color, position: r.position })),
      members: membersRes.data.slice(0, 50).map(m => ({
        id: m.user.id,
        username: m.user.username,
        discriminator: m.user.discriminator,
        avatar: m.user.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
          : null,
        roles: m.roles,
        joinedAt: m.joined_at
      }))
    });
  } catch (err) {
    console.error('Guild fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch guild details' });
  }
});

app.get('/api/guild/:id/staff', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!BOT_TOKEN) {
    return res.status(400).json({ error: 'Bot token not configured' });
  }

  try {
    const membersRes = await axios.get(`${DISCORD_API}/guilds/${id}/members?limit=100`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    const staffMembers = membersRes.data
      .filter(m => STAFF_IDS.includes(m.user.id))
      .map(m => ({
        id: m.user.id,
        username: m.user.username,
        discriminator: m.user.discriminator,
        avatar: m.user.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
          : null,
        roles: m.roles,
        joinedAt: m.joined_at
      }));

    res.json(staffMembers);
  } catch (err) {
    console.error('Staff fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    console.log('Melix Dashboard API running on port ' + PORT);
  });
}

