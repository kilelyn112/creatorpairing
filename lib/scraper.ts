import { searchYouTubeChannels, scrapeChannelEmail } from './apify';
import { getChannelDetails, getRecentVideos } from './youtube';
import { searchInstagramByHashtags, searchInstagramProfiles, searchInstagramBySeedAccounts, searchInstagramCoaches, generateInstagramHashtags, extractEmailFromBio, getInstagramProfiles } from './instagram';
import { qualifyCreator, qualifyInstagramCreator, qualifyXCreator } from './openai';
import { createJob, updateJobStatus, addCreator, getJob, getExistingIdentifiers, getCreatorsByJobId, linkCreatorToJob, searchCreatorsByKeyword, Platform } from './db';
import { searchGoogleForCreators, convertSerpResultToXProfile } from './serpapi';
import { v4 as uuidv4 } from 'uuid';

// YouTube thresholds
const MIN_SUBSCRIBERS = 2000;
const MIN_VIDEOS = 5;

// Instagram thresholds (for SerpAPI results, we're less strict since Google found them)
const MIN_FOLLOWERS = 1000;
const MIN_POSTS = 10;

// X thresholds
const MIN_X_FOLLOWERS = 500;

export interface SearchJobInput {
  keyword: string;
  maxResults: number;
  platform: Platform;
  seedAccounts?: string[]; // Optional seed accounts for Instagram seed-based search
}

/**
 * Start a new search job - creates the job and returns immediately
 * The actual processing happens asynchronously
 */
export function startSearchJob(input: SearchJobInput): string {
  const jobId = uuidv4();
  const platform = input.platform || 'youtube';
  console.log(`[${jobId}] Starting job with platform: "${platform}"`);

  // Start processing in the background based on platform
  (async () => {
    await createJob(jobId, input.keyword, input.maxResults, platform);

    if (platform === 'instagram') {
      console.log(`[${jobId}] Routing to Instagram job processor`);
      processInstagramJob(jobId, input.keyword, input.maxResults, input.seedAccounts).catch(async (error) => {
        console.error(`Instagram Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, 'failed', undefined, undefined, error.message);
      });
    } else if (platform === 'x') {
      console.log(`[${jobId}] Routing to X job processor`);
      processXJob(jobId, input.keyword, input.maxResults).catch(async (error) => {
        console.error(`X Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, 'failed', undefined, undefined, error.message);
      });
    } else {
      // Default to YouTube
      console.log(`[${jobId}] Routing to YouTube job processor (platform="${platform}")`);
      processYouTubeJob(jobId, input.keyword, input.maxResults).catch(async (error) => {
        console.error(`YouTube Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, 'failed', undefined, undefined, error.message);
      });
    }
  })();

  return jobId;
}

/**
 * Process a YouTube search job - this runs asynchronously
 */
async function processYouTubeJob(
  jobId: string,
  keyword: string,
  maxResults: number
): Promise<void> {
  try {
    await updateJobStatus(jobId, 'processing');

    // Step 1: Search YouTube channels via Apify
    console.log(`[${jobId}] Searching YouTube for channels with keyword: ${keyword}`);
    const searchResults = await searchYouTubeChannels(keyword, maxResults);
    console.log(`[${jobId}] Found ${searchResults.length} channels`);

    // Deduplicate by channel ID
    const uniqueChannels = new Map<string, typeof searchResults[0]>();
    for (const result of searchResults) {
      if (result.channelId && !uniqueChannels.has(result.channelId)) {
        uniqueChannels.set(result.channelId, result);
      }
    }

    const channels = Array.from(uniqueChannels.values());
    await updateJobStatus(jobId, 'processing', 0, channels.length);

    // Step 2: Process each channel
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];

      // Check if job was cancelled or failed
      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'failed') {
        console.log(`[${jobId}] Job was cancelled, stopping processing`);
        return;
      }

      console.log(`[${jobId}] Processing channel ${i + 1}/${channels.length}: ${channel.channelName}`);

      try {
        // Pre-filter by subscriber count from Apify data
        if (channel.numberOfSubscribers < MIN_SUBSCRIBERS) {
          console.log(`[${jobId}] Skipping ${channel.channelName} - only ${channel.numberOfSubscribers} subscribers`);
          await updateJobStatus(jobId, 'processing', i + 1, channels.length);
          continue;
        }

        // Get detailed channel info from YouTube API
        const channelDetails = await getChannelDetails(channel.channelId);
        if (!channelDetails) {
          console.log(`[${jobId}] Could not get details for ${channel.channelName}`);
          await updateJobStatus(jobId, 'processing', i + 1, channels.length);
          continue;
        }

        // Filter by video count
        if (channelDetails.videoCount < MIN_VIDEOS) {
          console.log(`[${jobId}] Skipping ${channel.channelName} - only ${channelDetails.videoCount} videos`);
          await updateJobStatus(jobId, 'processing', i + 1, channels.length);
          continue;
        }

        // Get recent videos for AI analysis
        const videos = await getRecentVideos(channelDetails.uploadsPlaylistId, 10);

        // AI Qualification
        const qualification = await qualifyCreator(
          channelDetails,
          videos,
          channel.descriptionLinks,
          keyword
        );

        console.log(`[${jobId}] ${channel.channelName}: qualified=${qualification.qualified}`);

        // Scrape email if qualified
        let email: string | null = null;
        if (qualification.qualified) {
          const channelUrl = `${channel.channelUrl}/videos`;
          const emailResult = await scrapeChannelEmail(channelUrl);
          if (emailResult.email.length > 0) {
            email = emailResult.email[0];
            console.log(`[${jobId}] Found email for ${channel.channelName}: ${email}`);
          }
        }

        // Save to database with new schema
        await addCreator({
          job_id: jobId,
          platform: 'youtube',
          platform_id: channel.channelId,
          username: null,
          display_name: channel.channelName,
          profile_url: channel.channelUrl,
          followers: channelDetails.subscriberCount,
          following: 0,
          post_count: channelDetails.videoCount,
          total_views: channelDetails.viewCount,
          engagement_rate: 0,
          bio: channelDetails.description || null,
          external_url: null,
          qualified: qualification.qualified,
          qualification_reason: qualification.reason,
          email: email,
          first_name: null,
          niche: keyword, // FLYWHEEL: Store niche for future cached searches
        });

        await updateJobStatus(jobId, 'processing', i + 1, channels.length);

        // Small delay to avoid rate limiting
        await sleep(500);
      } catch (error) {
        console.error(`[${jobId}] Error processing channel ${channel.channelName}:`, error);
        // Continue with next channel
        await updateJobStatus(jobId, 'processing', i + 1, channels.length);
      }
    }

    // Mark job as complete
    await updateJobStatus(jobId, 'completed', channels.length, channels.length);
    console.log(`[${jobId}] YouTube job completed successfully`);
  } catch (error) {
    console.error(`[${jobId}] YouTube job failed:`, error);
    await updateJobStatus(
      jobId,
      'failed',
      undefined,
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Process an Instagram search job - this runs asynchronously
 * Uses SerpAPI (Google search) as primary discovery method
 */
async function processInstagramJob(
  jobId: string,
  keyword: string,
  maxResults: number,
  seedAccounts?: string[]
): Promise<void> {
  try {
    await updateJobStatus(jobId, 'processing');

    const profilesToFetch = Math.min(maxResults * 2, 100); // Fetch 2x since some may be filtered

    let usernames: string[] = [];

    // PRIMARY METHOD: Use SerpAPI/Google search to find Instagram profiles
    // This finds profiles with coaching language in their bios (indexed by Google)
    console.log(`[${jobId}] Using SERPAPI/Google search for Instagram profiles: ${keyword}`);
    const serpResults = await searchGoogleForCreators(keyword, 'instagram', profilesToFetch);
    console.log(`[${jobId}] SerpAPI found ${serpResults.length} Instagram profiles`);

    // Extract usernames from SerpAPI results
    usernames = serpResults.map(r => r.username);

    // FALLBACK: If SerpAPI didn't find enough and seed accounts provided, use seed-based search
    if (usernames.length < profilesToFetch / 2 && seedAccounts && seedAccounts.length > 0) {
      console.log(`[${jobId}] Supplementing with seed-based search...`);
      const seedResults = await searchInstagramBySeedAccounts(seedAccounts, profilesToFetch - usernames.length);
      const existingUsernames = new Set(usernames.map(u => u.toLowerCase()));
      for (const result of seedResults) {
        if (!existingUsernames.has(result.username.toLowerCase())) {
          usernames.push(result.username);
          existingUsernames.add(result.username.toLowerCase());
        }
      }
      console.log(`[${jobId}] After seed search: ${usernames.length} total profiles`);
    }

    console.log(`[${jobId}] Found ${usernames.length} unique Instagram usernames`);

    // Get full profile details for all usernames via Apify
    console.log(`[${jobId}] Fetching full profile details for ${usernames.length} users...`);
    const fetchedProfiles = await getInstagramProfiles(usernames);
    console.log(`[${jobId}] Retrieved ${fetchedProfiles.length} full profiles`);

    // Convert profiles to search results format
    const searchResults = fetchedProfiles.map(profile => ({
      username: profile.username,
      userId: profile.id,
      fullName: profile.fullName,
      biography: profile.biography,
      externalUrl: profile.externalUrl,
      followersCount: profile.followersCount,
      followsCount: profile.followsCount,
      postsCount: profile.postsCount,
      isVerified: profile.isVerified,
      isBusinessAccount: profile.isBusinessAccount,
      businessCategoryName: profile.businessCategoryName,
      profilePicUrl: profile.profilePicUrl,
      engagementRate: 0,
      recentPosts: [] as { caption: string; likesCount: number; commentsCount: number; timestamp: string }[],
    }));

    console.log(`[${jobId}] Found ${searchResults.length} total Instagram profiles`);

    // Deduplicate by username
    const uniqueProfiles = new Map<string, typeof searchResults[0]>();
    for (const result of searchResults) {
      if (result.username && !uniqueProfiles.has(result.username)) {
        uniqueProfiles.set(result.username, result);
      }
    }

    const profiles = Array.from(uniqueProfiles.values());
    await updateJobStatus(jobId, 'processing', 0, profiles.length);

    // Step 3: Process each profile
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];

      // Check if job was cancelled or failed
      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'failed') {
        console.log(`[${jobId}] Job was cancelled, stopping processing`);
        return;
      }

      console.log(`[${jobId}] Processing Instagram profile ${i + 1}/${profiles.length}: @${profile.username}`);

      try {
        // Pre-filter by follower count
        if (profile.followersCount < MIN_FOLLOWERS) {
          console.log(`[${jobId}] Skipping @${profile.username} - only ${profile.followersCount} followers`);
          await updateJobStatus(jobId, 'processing', i + 1, profiles.length);
          continue;
        }

        // Pre-filter by post count
        if (profile.postsCount < MIN_POSTS) {
          console.log(`[${jobId}] Skipping @${profile.username} - only ${profile.postsCount} posts`);
          await updateJobStatus(jobId, 'processing', i + 1, profiles.length);
          continue;
        }

        // AI Qualification (pass keyword for niche-specific filtering)
        const qualification = await qualifyInstagramCreator(profile, keyword);

        console.log(`[${jobId}] @${profile.username}: qualified=${qualification.qualified}`);

        // Try to extract email from bio
        let email: string | null = null;
        if (qualification.qualified) {
          email = extractEmailFromBio(profile.biography || '');
          if (email) {
            console.log(`[${jobId}] Found email for @${profile.username}: ${email}`);
          }
        }

        // Extract first name from full name
        const firstName = profile.fullName ? profile.fullName.split(' ')[0] : null;

        // Save to database
        await addCreator({
          job_id: jobId,
          platform: 'instagram',
          platform_id: profile.userId,
          username: profile.username,
          display_name: profile.fullName || profile.username,
          profile_url: `https://instagram.com/${profile.username}`,
          followers: profile.followersCount,
          following: profile.followsCount,
          post_count: profile.postsCount,
          total_views: 0, // Instagram doesn't expose total views
          engagement_rate: profile.engagementRate,
          bio: profile.biography || null,
          external_url: profile.externalUrl || null,
          qualified: qualification.qualified,
          qualification_reason: qualification.reason,
          email: email,
          first_name: firstName,
          niche: keyword, // FLYWHEEL: Store niche for future cached searches
        });

        await updateJobStatus(jobId, 'processing', i + 1, profiles.length);

        // Small delay to avoid rate limiting
        await sleep(500);
      } catch (error) {
        console.error(`[${jobId}] Error processing Instagram profile @${profile.username}:`, error);
        // Continue with next profile
        await updateJobStatus(jobId, 'processing', i + 1, profiles.length);
      }
    }

    // Mark job as complete
    await updateJobStatus(jobId, 'completed', profiles.length, profiles.length);
    console.log(`[${jobId}] Instagram job completed successfully`);
  } catch (error) {
    console.error(`[${jobId}] Instagram job failed:`, error);
    await updateJobStatus(
      jobId,
      'failed',
      undefined,
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Process an X/Twitter search job - this runs asynchronously
 * Uses SerpAPI (Google search) to find X profiles with coaching keywords
 */
async function processXJob(
  jobId: string,
  keyword: string,
  maxResults: number
): Promise<void> {
  try {
    await updateJobStatus(jobId, 'processing');

    const profilesToFetch = Math.min(maxResults * 2, 100);

    // Use SerpAPI/Google search to find X profiles
    console.log(`[${jobId}] Using SERPAPI/Google search for X profiles: ${keyword}`);
    const serpResults = await searchGoogleForCreators(keyword, 'x', profilesToFetch);
    console.log(`[${jobId}] SerpAPI found ${serpResults.length} X profiles`);

    // Deduplicate by username
    const uniqueProfiles = new Map<string, typeof serpResults[0]>();
    for (const result of serpResults) {
      if (result.username && !uniqueProfiles.has(result.username.toLowerCase())) {
        uniqueProfiles.set(result.username.toLowerCase(), result);
      }
    }

    const profiles = Array.from(uniqueProfiles.values());
    await updateJobStatus(jobId, 'processing', 0, profiles.length);

    console.log(`[${jobId}] Processing ${profiles.length} unique X profiles`);

    // Process each profile
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];

      // Check if job was cancelled
      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'failed') {
        console.log(`[${jobId}] Job was cancelled, stopping processing`);
        return;
      }

      console.log(`[${jobId}] Processing X profile ${i + 1}/${profiles.length}: @${profile.username}`);

      try {
        // Convert to XProfile format for qualification
        const xProfile = convertSerpResultToXProfile(profile);

        // AI Qualification
        const qualification = await qualifyXCreator(xProfile, keyword);

        console.log(`[${jobId}] @${profile.username}: qualified=${qualification.qualified}`);

        // Try to extract email from snippet (Google often includes bio text)
        let email: string | null = null;
        if (qualification.qualified) {
          email = extractEmailFromBio(profile.snippet);
          if (email) {
            console.log(`[${jobId}] Found email for @${profile.username}: ${email}`);
          }
        }

        // Extract first name from title
        const firstName = profile.title ? profile.title.split(/[\s(|@]/)[0] : null;

        // Save to database
        await addCreator({
          job_id: jobId,
          platform: 'x',
          platform_id: profile.username,
          username: profile.username,
          display_name: xProfile.displayName,
          profile_url: profile.url,
          followers: 0, // X API is restricted, we don't have this
          following: 0,
          post_count: 0,
          total_views: 0,
          engagement_rate: 0,
          bio: profile.snippet,
          external_url: null,
          qualified: qualification.qualified,
          qualification_reason: qualification.reason,
          email: email,
          first_name: firstName,
          niche: keyword, // FLYWHEEL: Store niche for future cached searches
        });

        await updateJobStatus(jobId, 'processing', i + 1, profiles.length);

        // Small delay to avoid rate limiting
        await sleep(300);
      } catch (error) {
        console.error(`[${jobId}] Error processing X profile @${profile.username}:`, error);
        await updateJobStatus(jobId, 'processing', i + 1, profiles.length);
      }
    }

    // Mark job as complete
    await updateJobStatus(jobId, 'completed', profiles.length, profiles.length);
    console.log(`[${jobId}] X job completed successfully`);
  } catch (error) {
    console.error(`[${jobId}] X job failed:`, error);
    await updateJobStatus(
      jobId,
      'failed',
      undefined,
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Continue an existing search job - finds more creators for the same keyword
 * Skips already-processed creators and uses different query variations
 */
/**
 * Pull qualified creators of this niche from the global cache that aren't
 * already attached to this job. Returns the number we managed to link in.
 */
async function fillFromNicheCache(
  jobId: string,
  platform: Platform,
  keyword: string,
  needed: number
): Promise<number> {
  if (needed <= 0) return 0;
  const existing = await getExistingIdentifiers(jobId);
  // Pull a wider net than `needed` since many will already be in the job
  const cached = await searchCreatorsByKeyword(platform, keyword, Math.max(needed * 3, 50));
  let linked = 0;
  for (const c of cached) {
    if (linked >= needed) break;
    const pid = (c.platform_id || '').toLowerCase();
    const uname = (c.username || '').toLowerCase();
    if (pid && existing.has(pid)) continue;
    if (uname && existing.has(uname)) continue;
    await linkCreatorToJob(jobId, c.id);
    if (pid) existing.add(pid);
    if (uname) existing.add(uname);
    linked++;
  }
  console.log(`[${jobId}] Cache filled ${linked}/${needed} from niche "${keyword}" on ${platform}`);
  return linked;
}

export function continueSearchJob(
  jobId: string,
  keyword: string,
  maxResults: number,
  platform: Platform
): void {
  console.log(`[${jobId}] Continuing search for "${keyword}" on ${platform}`);

  // Start async continuation
  (async () => {
    // Step 1: cache-first — link any cached creators of this niche that aren't already in the job.
    // This is free and instant. If it fully satisfies the request, we're done.
    await updateJobStatus(jobId, 'processing');
    const filledFromCache = await fillFromNicheCache(jobId, platform, keyword, maxResults);
    const remaining = maxResults - filledFromCache;

    if (remaining <= 0) {
      console.log(`[${jobId}] Cache satisfied the request — no scrape needed`);
      await updateJobStatus(jobId, 'completed');
      return;
    }

    // Step 2: fall back to a fresh scrape for the remainder.
    // Get existing creators count to calculate query offset (now includes cache hits).
    const existingCreators = await getCreatorsByJobId(jobId);
    const queryOffset = existingCreators.length * 2; // bigger jump per click than before (was /10 * 5)

    if (platform === 'instagram') {
      console.log(`[${jobId}] Continuing Instagram search with offset ${queryOffset}`);
      continueInstagramJob(jobId, keyword, remaining, queryOffset).catch(async (error) => {
        console.error(`Continue Instagram Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, 'failed', undefined, undefined, error.message);
      });
    } else if (platform === 'x') {
      console.log(`[${jobId}] Continuing X search with offset ${queryOffset}`);
      continueXJob(jobId, keyword, remaining, queryOffset).catch(async (error) => {
        console.error(`Continue X Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, 'failed', undefined, undefined, error.message);
      });
    } else {
      // YouTube continuation - search with different keywords
      console.log(`[${jobId}] Continuing YouTube search`);
      continueYouTubeJob(jobId, keyword, remaining, existingCreators.length).catch(async (error) => {
        console.error(`Continue YouTube Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, 'failed', undefined, undefined, error.message);
      });
    }
  })();
}

/**
 * Continue Instagram search with query offset
 */
async function continueInstagramJob(
  jobId: string,
  keyword: string,
  maxResults: number,
  queryOffset: number
): Promise<void> {
  try {
    await updateJobStatus(jobId, 'processing');

    // Get existing usernames to exclude
    const existingIdentifiers = await getExistingIdentifiers(jobId);
    console.log(`[${jobId}] Excluding ${existingIdentifiers.size} existing creators`);

    const profilesToFetch = Math.min(maxResults * 2, 100);

    // Use SerpAPI with query offset to get different results
    console.log(`[${jobId}] Using SERPAPI with offset ${queryOffset} for more Instagram profiles`);
    const serpResults = await searchGoogleForCreators(keyword, 'instagram', profilesToFetch, queryOffset, existingIdentifiers);
    console.log(`[${jobId}] SerpAPI found ${serpResults.length} new Instagram profiles`);

    if (serpResults.length === 0) {
      console.log(`[${jobId}] No new profiles found, completing job`);
      await updateJobStatus(jobId, 'completed');
      return;
    }

    // Extract usernames, filtering out existing ones
    const usernames = serpResults
      .map(r => r.username)
      .filter(u => !existingIdentifiers.has(u.toLowerCase()));

    console.log(`[${jobId}] ${usernames.length} new unique usernames to process`);

    if (usernames.length === 0) {
      await updateJobStatus(jobId, 'completed');
      return;
    }

    // Get full profile details via Apify
    const fetchedProfiles = await getInstagramProfiles(usernames);
    console.log(`[${jobId}] Retrieved ${fetchedProfiles.length} full profiles`);

    // Convert profiles to search results format
    const profiles = fetchedProfiles.map(profile => ({
      username: profile.username,
      userId: profile.id,
      fullName: profile.fullName,
      biography: profile.biography,
      externalUrl: profile.externalUrl,
      followersCount: profile.followersCount,
      followsCount: profile.followsCount,
      postsCount: profile.postsCount,
      isVerified: profile.isVerified,
      isBusinessAccount: profile.isBusinessAccount,
      businessCategoryName: profile.businessCategoryName,
      profilePicUrl: profile.profilePicUrl,
      engagementRate: 0,
      recentPosts: [] as { caption: string; likesCount: number; commentsCount: number; timestamp: string }[],
    }));

    // Process each profile (same logic as original)
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];

      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'failed') {
        console.log(`[${jobId}] Job was cancelled, stopping`);
        return;
      }

      console.log(`[${jobId}] Processing Instagram profile ${i + 1}/${profiles.length}: @${profile.username}`);

      try {
        if (profile.followersCount < MIN_FOLLOWERS || profile.postsCount < MIN_POSTS) {
          continue;
        }

        const qualification = await qualifyInstagramCreator(profile, keyword);
        console.log(`[${jobId}] @${profile.username}: qualified=${qualification.qualified}`);

        let email: string | null = null;
        if (qualification.qualified) {
          email = extractEmailFromBio(profile.biography || '');
        }

        const firstName = profile.fullName ? profile.fullName.split(' ')[0] : null;

        await addCreator({
          job_id: jobId,
          platform: 'instagram',
          platform_id: profile.userId,
          username: profile.username,
          display_name: profile.fullName || profile.username,
          profile_url: `https://instagram.com/${profile.username}`,
          followers: profile.followersCount,
          following: profile.followsCount,
          post_count: profile.postsCount,
          total_views: 0,
          engagement_rate: profile.engagementRate,
          bio: profile.biography || null,
          external_url: profile.externalUrl || null,
          qualified: qualification.qualified,
          qualification_reason: qualification.reason,
          email: email,
          first_name: firstName,
          niche: keyword, // FLYWHEEL: Store niche for future cached searches
        });

        await sleep(500);
      } catch (error) {
        console.error(`[${jobId}] Error processing @${profile.username}:`, error);
      }
    }

    await updateJobStatus(jobId, 'completed');
    console.log(`[${jobId}] Instagram continuation completed`);
  } catch (error) {
    console.error(`[${jobId}] Instagram continuation failed:`, error);
    await updateJobStatus(jobId, 'failed', undefined, undefined, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Continue X search with query offset
 */
async function continueXJob(
  jobId: string,
  keyword: string,
  maxResults: number,
  queryOffset: number
): Promise<void> {
  try {
    await updateJobStatus(jobId, 'processing');

    const existingIdentifiers = await getExistingIdentifiers(jobId);
    console.log(`[${jobId}] Excluding ${existingIdentifiers.size} existing X profiles`);

    const profilesToFetch = Math.min(maxResults * 2, 100);

    const serpResults = await searchGoogleForCreators(keyword, 'x', profilesToFetch, queryOffset, existingIdentifiers);
    console.log(`[${jobId}] SerpAPI found ${serpResults.length} new X profiles`);

    if (serpResults.length === 0) {
      await updateJobStatus(jobId, 'completed');
      return;
    }

    // Filter out existing usernames
    const newProfiles = serpResults.filter(r => !existingIdentifiers.has(r.username.toLowerCase()));
    console.log(`[${jobId}] ${newProfiles.length} new unique X profiles to process`);

    for (let i = 0; i < newProfiles.length; i++) {
      const profile = newProfiles[i];

      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'failed') {
        return;
      }

      console.log(`[${jobId}] Processing X profile ${i + 1}/${newProfiles.length}: @${profile.username}`);

      try {
        const xProfile = convertSerpResultToXProfile(profile);
        const qualification = await qualifyXCreator(xProfile, keyword);
        console.log(`[${jobId}] @${profile.username}: qualified=${qualification.qualified}`);

        let email: string | null = null;
        if (qualification.qualified) {
          email = extractEmailFromBio(profile.snippet);
        }

        const firstName = profile.title ? profile.title.split(/[\s(|@]/)[0] : null;

        await addCreator({
          job_id: jobId,
          platform: 'x',
          platform_id: profile.username,
          username: profile.username,
          display_name: xProfile.displayName,
          profile_url: profile.url,
          followers: 0,
          following: 0,
          post_count: 0,
          total_views: 0,
          engagement_rate: 0,
          bio: profile.snippet,
          external_url: null,
          qualified: qualification.qualified,
          qualification_reason: qualification.reason,
          email: email,
          first_name: firstName,
          niche: keyword, // FLYWHEEL: Store niche for future cached searches
        });

        await sleep(300);
      } catch (error) {
        console.error(`[${jobId}] Error processing @${profile.username}:`, error);
      }
    }

    await updateJobStatus(jobId, 'completed');
    console.log(`[${jobId}] X continuation completed`);
  } catch (error) {
    console.error(`[${jobId}] X continuation failed:`, error);
    await updateJobStatus(jobId, 'failed', undefined, undefined, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Continue YouTube search - uses modified keywords to find different channels
 */
async function continueYouTubeJob(
  jobId: string,
  keyword: string,
  maxResults: number,
  existingCount: number = 0
): Promise<void> {
  try {
    await updateJobStatus(jobId, 'processing');

    const existingIdentifiers = await getExistingIdentifiers(jobId);
    console.log(`[${jobId}] Excluding ${existingIdentifiers.size} existing YouTube channels`);

    // Cycle through variations deterministically — each "Find More" click uses
    // the next variation in order, so the same one isn't picked twice in a row.
    const variations = [
      `${keyword} tutorial`,
      `${keyword} tips`,
      `${keyword} course`,
      `${keyword} how to`,
      `${keyword} beginners`,
    ];
    const variationIdx = Math.floor(existingCount / Math.max(maxResults, 1)) % variations.length;
    const variation = variations[variationIdx];

    console.log(`[${jobId}] Searching YouTube with variation: "${variation}"`);
    const searchResults = await searchYouTubeChannels(variation, maxResults);
    console.log(`[${jobId}] Found ${searchResults.length} channels`);

    // Filter out existing channels
    const newChannels = searchResults.filter(c => !existingIdentifiers.has(c.channelId.toLowerCase()));
    console.log(`[${jobId}] ${newChannels.length} new channels to process`);

    for (let i = 0; i < newChannels.length; i++) {
      const channel = newChannels[i];

      const currentJob = await getJob(jobId);
      if (currentJob?.status === 'failed') {
        return;
      }

      console.log(`[${jobId}] Processing channel ${i + 1}/${newChannels.length}: ${channel.channelName}`);

      try {
        if (channel.numberOfSubscribers < MIN_SUBSCRIBERS) continue;

        const channelDetails = await getChannelDetails(channel.channelId);
        if (!channelDetails || channelDetails.videoCount < MIN_VIDEOS) continue;

        const videos = await getRecentVideos(channelDetails.uploadsPlaylistId, 10);
        const qualification = await qualifyCreator(channelDetails, videos, channel.descriptionLinks);

        console.log(`[${jobId}] ${channel.channelName}: qualified=${qualification.qualified}`);

        let email: string | null = null;
        if (qualification.qualified) {
          const channelUrl = `${channel.channelUrl}/videos`;
          const emailResult = await scrapeChannelEmail(channelUrl);
          if (emailResult.email.length > 0) {
            email = emailResult.email[0];
          }
        }

        await addCreator({
          job_id: jobId,
          platform: 'youtube',
          platform_id: channel.channelId,
          username: null,
          display_name: channel.channelName,
          profile_url: channel.channelUrl,
          followers: channelDetails.subscriberCount,
          following: 0,
          post_count: channelDetails.videoCount,
          total_views: channelDetails.viewCount,
          engagement_rate: 0,
          bio: channelDetails.description || null,
          external_url: null,
          qualified: qualification.qualified,
          qualification_reason: qualification.reason,
          email: email,
          first_name: null,
          niche: keyword, // FLYWHEEL: Store niche for future cached searches
        });

        await sleep(500);
      } catch (error) {
        console.error(`[${jobId}] Error processing ${channel.channelName}:`, error);
      }
    }

    await updateJobStatus(jobId, 'completed');
    console.log(`[${jobId}] YouTube continuation completed`);
  } catch (error) {
    console.error(`[${jobId}] YouTube continuation failed:`, error);
    await updateJobStatus(jobId, 'failed', undefined, undefined, error instanceof Error ? error.message : 'Unknown error');
  }
}
