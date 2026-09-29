export interface PatchnotesEntry {
  version: string;
  date: string;
  time: string;
  title: string;
  desc: string;
  features: { title: string; desc: string }[];
  fixes: { title: string; desc: string }[];
}

export default [
  {
    version: '1.3.0',
    date: '2026-08-28',
    time: '22:30:00',
    title: 'Voice XP DM Notifications & Improvements',
    desc: 'Introducing automated Voice XP DM summaries! Track the duration of your voice sessions, applied multipliers, and earned XP directly in your direct messages.',
    features: [
      {
        title: 'Voice Session DM Summary',
        desc: 'Receive a sleek, detailed DM when leaving voice channels showing dynamic duration (hours/minutes), active multipliers, and total XP earned.',
      },
      {
        title: 'Member Notification Control',
        desc: 'Easily manage and toggle voice session notification preferences through /config-member settings.',
      },
    ],
    fixes: [
      {
        title: 'Leaderboard Refresh Optimization',
        desc: 'Optimized leaderboard update intervals to 15 minutes for improved scheduler and database efficiency.',
      },
      {
        title: 'Safe DM Dispatching',
        desc: 'Added silent error handling for closed direct messages and fallback server/bot avatar support.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-07',
    time: '20:30:00',
    title: 'Bonus XP Gifting & Fixes',
    desc: 'You can now share your bonus points with others on the server using the new Gifting system! Help your friends level up faster by gifting them points.',
    features: [
      {
        title: 'Bonus Gifting Command',
        desc: 'Use the new /gift command to transfer your bonus points to another member in the server.',
      },
      {
        title: 'Gifting Config',
        desc: 'Server administrators can enable or disable the gifting system via /config-server settings.',
      },
    ],
    fixes: [
      {
        title: 'Robust Gift Transactions',
        desc: 'Implemented strict checks to prevent balance desyncs when gifting quickly, and improved interaction timeouts.',
      }
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-05',
    time: '18:38:00',
    title: 'Guild Tag System & Perks Release',
    desc: 'The complete Guild Tag feature is now live! Boost member engagement with automatic role perks, custom welcome DM messages, and server-wide status displays.',
    features: [
      {
        title: 'Guild Tag Role & XP Multipliers',
        desc: 'Assign special roles and XP multipliers to members who wear the server Guild Tag.',
      },
      {
        title: 'Guild Tag DM Welcome Messages',
        desc: 'Send custom automated DM messages to members when they receive the Guild Tag perk, fully configurable via /config-messages.',
      },
      {
        title: 'Automated Member Scanning',
        desc: 'Configuring Guild Tag settings via /config-guildtag set automatically scans server members in the background to grant role perks.',
      },
      {
        title: 'Serverinfo & Config Integration',
        desc: 'Full integration across /serverinfo, /config-server set, and /config-messages for seamless setup and tracking.',
      },
    ],
    fixes: [],
  },
  {
    version: '1.0.0',
    date: '2026-07-28',
    time: '00:00:00',
    title: 'The Birth of Husky',
    desc: 'Today marks the beginning of a new era. Husky is officially live and ready to serve. Proudly crafted and coded by Deydays.',
    features: [
      {
        title: 'Initial Release',
        desc: 'Core architecture and foundational systems have been successfully deployed.',
      },
    ],
    fixes: [],
  },
] satisfies PatchnotesEntry[];
