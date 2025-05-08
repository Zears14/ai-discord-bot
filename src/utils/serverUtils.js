/**
 * @fileoverview Utility functions for server information
 * @module utils/serverUtils
 */

/**
 * Gets server information for AI context
 * @param {Message} message - Discord.js message object
 * @returns {Promise<[string, string, number, string[]]>} Array containing [username, serverName, memberCount, onlineMemberUsernames]
 */
async function getServerInfo(message) {
  try {
    const serverName = message.guild?.name || 'Direct Message';

    // Check if this is a DM
    if (!message.guild) {
      return [message.author.username, 'Direct Message', 1, [message.author.username]];
    }

    // For guild messages, get member information with caching and error handling
    let memberCount = 0;
    let onlineMemberUsernames = [];

    try {
      // Check if we need to fetch members (for large guilds)
      const shouldFetchMembers = message.guild.memberCount > 50 &&
        message.guild.members.cache.size < 50;

      if (shouldFetchMembers) {
        try {
          // Try to fetch more members, but don't fail if it doesn't work
          await message.guild.members.fetch({ limit: 100 })
            .catch(err => console.warn(`Couldn't fetch members: ${err.message}`));
        } catch (err) {
          console.warn(`Error fetching guild members: ${err.message}`);
        }
      }

      memberCount = message.guild.members.cache.filter(m => !m.user.bot).size;

      // Get online members with a reasonable limit
      onlineMemberUsernames = message.guild.members.cache
        .filter(m => !m.user.bot && m.presence?.status !== 'offline')
        .map(m => m.user.username)
        .slice(0, 20); // Limit to avoid huge messages

    } catch (err) {
      console.warn(`Error processing guild members: ${err.message}`);
      memberCount = message.guild.memberCount; // Fallback
      onlineMemberUsernames = [message.author.username]; // Fallback
    }

    return [message.author.username, serverName, memberCount, onlineMemberUsernames];
  } catch (error) {
    console.error('Error getting server info:', error);
    // Fallback to minimal info in case of errors
    return [message.author.username, 'Unknown Server', 1, [message.author.username]];
  }
}

module.exports = {
  getServerInfo
}; 