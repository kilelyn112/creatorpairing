import { supabase } from './supabase';

// Platform types
export type Platform = 'youtube' | 'instagram' | 'x' | 'tiktok' | 'linkedin' | 'skool' | 'substack';
export type FunnelPlatform = 'clickfunnels' | 'gohighlevel' | 'other';

export interface Job {
  id: string;
  keyword: string;
  platform: Platform;
  job_type: 'creator' | 'funnel';
  max_results: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  created_at: string;
  error?: string;
}

export interface Creator {
  id: number;
  platform: Platform;
  platform_id: string;
  username: string | null;
  display_name: string;
  profile_url: string;
  followers: number;
  following: number;
  post_count: number;
  total_views: number;
  engagement_rate: number;
  bio: string | null;
  external_url: string | null;
  qualified: boolean;
  qualification_reason: string;
  email: string | null;
  first_name: string | null;
  niche: string | null;
  created_at: string;
  updated_at: string;
  // Legacy compatibility
  job_id?: string;
}

export interface Funnel {
  id: number;
  funnel_url: string;
  domain: string | null;
  platform: FunnelPlatform;
  niche: string | null;
  quality_score: number;
  issues: string | null;
  has_mobile_viewport: boolean;
  has_clear_cta: boolean;
  has_testimonials: boolean;
  has_trust_badges: boolean;
  page_load_time: number | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  owner_instagram: string | null;
  owner_youtube: string | null;
  owner_x: string | null;
  owner_linkedin: string | null;
  owner_website: string | null;
  discovery_source: string;
  search_query: string | null;
  page_title: string | null;
  page_description: string | null;
  created_at: string;
  updated_at: string;
  // Legacy compatibility
  job_id?: string;
}

// ============ JOB OPERATIONS ============

export async function createJob(id: string, keyword: string, maxResults: number, platform: Platform = 'youtube', jobType: 'creator' | 'funnel' = 'creator'): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      id,
      keyword,
      platform,
      job_type: jobType,
      max_results: maxResults,
      status: 'pending',
      progress: 0,
      total: 0
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data as Job;
}

export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get job: ${error.message}`);
  }
  return data as Job;
}

export async function updateJobStatus(
  id: string,
  status: Job['status'],
  progress?: number,
  total?: number,
  error?: string
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (progress !== undefined) updates.progress = progress;
  if (total !== undefined) updates.total = total;
  if (error !== undefined) updates.error = error;

  const { error: updateError } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', id);

  if (updateError) throw new Error(`Failed to update job: ${updateError.message}`);
}

// ============ CREATOR OPERATIONS ============

export interface AddCreatorInput {
  job_id: string;
  platform: Platform;
  platform_id: string;
  username?: string | null;
  display_name: string;
  profile_url: string;
  followers: number;
  following?: number;
  post_count: number;
  total_views?: number;
  engagement_rate?: number;
  bio?: string | null;
  external_url?: string | null;
  qualified: boolean;
  qualification_reason: string;
  email?: string | null;
  first_name?: string | null;
  niche?: string | null;
}

// Check if creator exists in database (FLYWHEEL: cross-job lookup)
export async function findExistingCreator(platform: Platform, platformId: string): Promise<Creator | null> {
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .eq('platform', platform)
    .eq('platform_id', platformId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    return null; // Silently fail for lookups
  }
  return { ...data, qualified: Boolean(data.qualified) } as Creator;
}

// Find creators by username (for platforms like Instagram/X)
export async function findCreatorByUsername(platform: Platform, username: string): Promise<Creator | null> {
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .eq('platform', platform)
    .ilike('username', username)
    .single();

  if (error) return null;
  return { ...data, qualified: Boolean(data.qualified) } as Creator;
}

// Add or update creator (FLYWHEEL: upsert based on platform+platform_id)
export async function addCreator(creator: AddCreatorInput): Promise<Creator> {
  // First check if creator exists
  const existing = await findExistingCreator(creator.platform, creator.platform_id);

  if (existing) {
    // Update existing creator with new data if it's more complete
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Only update fields if new value is better
    if (creator.followers > existing.followers) updates.followers = creator.followers;
    if (creator.post_count > existing.post_count) updates.post_count = creator.post_count;
    if ((creator.total_views || 0) > existing.total_views) updates.total_views = creator.total_views;
    if (creator.email && !existing.email) updates.email = creator.email;
    if (creator.bio && !existing.bio) updates.bio = creator.bio;
    if (creator.external_url && !existing.external_url) updates.external_url = creator.external_url;
    if (creator.niche && !existing.niche) updates.niche = creator.niche;

    if (Object.keys(updates).length > 1) {
      await supabase.from('creators').update(updates).eq('id', existing.id);
    }

    // Link to current job
    await linkCreatorToJob(creator.job_id, existing.id);

    return { ...existing, ...updates, job_id: creator.job_id };
  }

  // Insert new creator
  const { data, error } = await supabase
    .from('creators')
    .insert({
      platform: creator.platform,
      platform_id: creator.platform_id,
      username: creator.username || null,
      display_name: creator.display_name,
      profile_url: creator.profile_url,
      followers: creator.followers,
      following: creator.following || 0,
      post_count: creator.post_count,
      total_views: creator.total_views || 0,
      engagement_rate: creator.engagement_rate || 0,
      bio: creator.bio || null,
      external_url: creator.external_url || null,
      qualified: creator.qualified,
      qualification_reason: creator.qualification_reason,
      email: creator.email || null,
      first_name: creator.first_name || null,
      niche: creator.niche || null
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add creator: ${error.message}`);

  // Link to job
  await linkCreatorToJob(creator.job_id, data.id);

  return { ...data, qualified: Boolean(data.qualified), job_id: creator.job_id } as Creator;
}

// Link creator to job via job_results table
export async function linkCreatorToJob(jobId: string, creatorId: number): Promise<void> {
  const { error } = await supabase
    .from('job_results')
    .insert({ job_id: jobId, creator_id: creatorId });

  // Ignore duplicate key errors (23505), log others
  if (error && error.code !== '23505') {
    console.error('Error linking creator to job:', error);
  }
}

export async function getCreatorById(id: number): Promise<Creator | null> {
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return { ...data, qualified: Boolean(data.qualified) } as Creator;
}

export async function getCreatorsByJobId(jobId: string): Promise<Creator[]> {
  const { data, error } = await supabase
    .from('job_results')
    .select('creator_id, creators(*)')
    .eq('job_id', jobId)
    .not('creator_id', 'is', null);

  if (error) return [];

  return (data || [])
    .filter((row: { creator_id: number; creators: unknown }) => row.creators)
    .map((row: { creator_id: number; creators: unknown }) => {
      const creator = row.creators as unknown as Record<string, unknown>;
      return {
        ...(creator as unknown as Creator),
        qualified: Boolean(creator.qualified),
        job_id: jobId
      };
    })
    .sort((a: Creator, b: Creator) => {
      if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      return b.followers - a.followers;
    });
}

export async function getQualifiedCreatorsByJobId(jobId: string): Promise<Creator[]> {
  const creators = await getCreatorsByJobId(jobId);
  return creators.filter(c => c.qualified);
}

// Get existing identifiers for deduplication during scraping
export async function getExistingIdentifiers(jobId: string): Promise<Set<string>> {
  const creators = await getCreatorsByJobId(jobId);
  const identifiers = new Set<string>();
  for (const c of creators) {
    if (c.platform_id) identifiers.add(c.platform_id.toLowerCase());
    if (c.username) identifiers.add(c.username.toLowerCase());
  }
  return identifiers;
}

// FLYWHEEL: Check database for existing creators before scraping
export async function findExistingCreatorsByNiche(platform: Platform, niche: string, limit: number = 100): Promise<Creator[]> {
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .eq('platform', platform)
    .ilike('niche', `%${niche}%`)
    .order('followers', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).map((c: Record<string, unknown>) => ({ ...c, qualified: Boolean(c.qualified) })) as Creator[];
}

// FLYWHEEL: Search creators by keyword across multiple fields (main flywheel function)
// Only returns qualified creators — unqualified/niche-mismatched results are excluded
export async function searchCreatorsByKeyword(platform: Platform, keyword: string, limit: number = 100): Promise<Creator[]> {
  const searchTerm = `%${keyword.toLowerCase()}%`;

  // Search across multiple relevant fields, only return qualified creators
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .eq('platform', platform)
    .eq('qualified', true)
    .ilike('niche', searchTerm)
    .order('followers', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error searching creators:', error);
    return [];
  }
  return (data || []).map((c: Record<string, unknown>) => ({ ...c, qualified: Boolean(c.qualified) })) as Creator[];
}

// ADMIN: Clear cached creators for a specific niche/keyword and platform
export async function clearCachedCreators(platform: Platform | 'all', keyword?: string): Promise<number> {
  let query = supabase.from('creators').delete();

  if (platform !== 'all') {
    query = query.eq('platform', platform);
  }

  if (keyword) {
    query = query.ilike('niche', `%${keyword.toLowerCase()}%`);
  }

  const { data, error } = await query.select('id');

  if (error) {
    console.error('Error clearing cached creators:', error);
    throw new Error('Failed to clear cached creators');
  }

  return data?.length || 0;
}

// FLYWHEEL: Get all platform_ids from database to exclude during scraping
export async function getExistingPlatformIds(platform: Platform): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('creators')
    .select('platform_id')
    .eq('platform', platform);

  if (error) return new Set();
  return new Set((data || []).map(c => c.platform_id));
}

// ============ FUNNEL OPERATIONS ============

export interface AddFunnelInput {
  job_id: string;
  funnel_url: string;
  domain?: string | null;
  platform: FunnelPlatform;
  niche?: string | null;
  quality_score?: number;
  issues?: string[] | null;
  has_mobile_viewport?: boolean;
  has_clear_cta?: boolean;
  has_testimonials?: boolean;
  has_trust_badges?: boolean;
  page_load_time?: number | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  owner_instagram?: string | null;
  owner_youtube?: string | null;
  owner_x?: string | null;
  owner_linkedin?: string | null;
  owner_website?: string | null;
  discovery_source?: string;
  search_query?: string | null;
  page_title?: string | null;
  page_description?: string | null;
}

// Check if funnel exists (FLYWHEEL)
export async function findExistingFunnel(funnelUrl: string): Promise<Funnel | null> {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('funnel_url', funnelUrl)
    .single();

  if (error) return null;
  return normalizeFunnelRow(data);
}

export async function addFunnel(funnel: AddFunnelInput): Promise<Funnel> {
  // Check if exists
  const existing = await findExistingFunnel(funnel.funnel_url);

  if (existing) {
    // Update with new data
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (funnel.owner_email && !existing.owner_email) updates.owner_email = funnel.owner_email;
    if (funnel.owner_name && !existing.owner_name) updates.owner_name = funnel.owner_name;
    if ((funnel.quality_score || 0) > existing.quality_score) updates.quality_score = funnel.quality_score;

    if (Object.keys(updates).length > 1) {
      await supabase.from('funnels').update(updates).eq('id', existing.id);
    }

    await linkFunnelToJob(funnel.job_id, existing.id);
    return { ...existing, ...updates, job_id: funnel.job_id };
  }

  // Insert new funnel
  const { data, error } = await supabase
    .from('funnels')
    .insert({
      funnel_url: funnel.funnel_url,
      domain: funnel.domain || null,
      platform: funnel.platform,
      niche: funnel.niche || null,
      quality_score: funnel.quality_score || 0,
      issues: funnel.issues || null,
      has_mobile_viewport: funnel.has_mobile_viewport || false,
      has_clear_cta: funnel.has_clear_cta || false,
      has_testimonials: funnel.has_testimonials || false,
      has_trust_badges: funnel.has_trust_badges || false,
      page_load_time: funnel.page_load_time || null,
      owner_name: funnel.owner_name || null,
      owner_email: funnel.owner_email || null,
      owner_phone: funnel.owner_phone || null,
      owner_instagram: funnel.owner_instagram || null,
      owner_youtube: funnel.owner_youtube || null,
      owner_x: funnel.owner_x || null,
      owner_linkedin: funnel.owner_linkedin || null,
      owner_website: funnel.owner_website || null,
      discovery_source: funnel.discovery_source || 'google',
      search_query: funnel.search_query || null,
      page_title: funnel.page_title || null,
      page_description: funnel.page_description || null
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add funnel: ${error.message}`);

  await linkFunnelToJob(funnel.job_id, data.id);

  return { ...normalizeFunnelRow(data), job_id: funnel.job_id };
}

async function linkFunnelToJob(jobId: string, funnelId: number): Promise<void> {
  const { error } = await supabase
    .from('job_results')
    .insert({ job_id: jobId, funnel_id: funnelId });

  // Ignore duplicate key errors (23505), log others
  if (error && error.code !== '23505') {
    console.error('Error linking funnel to job:', error);
  }
}

export async function getFunnelById(id: number): Promise<Funnel | null> {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return normalizeFunnelRow(data);
}

export async function getFunnelsByJobId(jobId: string): Promise<Funnel[]> {
  const { data, error } = await supabase
    .from('job_results')
    .select('funnel_id, funnels(*)')
    .eq('job_id', jobId)
    .not('funnel_id', 'is', null);

  if (error) return [];

  return (data || [])
    .filter(row => row.funnels)
    .map(row => {
      const funnel = row.funnels as unknown as Record<string, unknown>;
      return {
        ...normalizeFunnelRow(funnel),
        job_id: jobId
      };
    })
    .sort((a, b) => b.quality_score - a.quality_score);
}

export async function getFunnelsWithEmailByJobId(jobId: string): Promise<Funnel[]> {
  const funnels = await getFunnelsByJobId(jobId);
  return funnels.filter(f => f.owner_email);
}

export async function getExistingFunnelDomains(jobId: string): Promise<Set<string>> {
  const funnels = await getFunnelsByJobId(jobId);
  return new Set(funnels.filter(f => f.domain).map(f => f.domain!.toLowerCase()));
}

// FLYWHEEL: Find existing funnels by niche
export async function findExistingFunnelsByNiche(niche: string, limit: number = 100): Promise<Funnel[]> {
  const { data, error } = await supabase
    .from('funnels')
    .select('*')
    .ilike('niche', `%${niche}%`)
    .order('quality_score', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).map(normalizeFunnelRow);
}

function normalizeFunnelRow(row: Record<string, unknown>): Funnel {
  return {
    id: row.id as number,
    funnel_url: row.funnel_url as string,
    domain: row.domain as string | null,
    platform: row.platform as FunnelPlatform,
    niche: row.niche as string | null,
    quality_score: row.quality_score as number,
    issues: row.issues ? JSON.stringify(row.issues) : null,
    has_mobile_viewport: Boolean(row.has_mobile_viewport),
    has_clear_cta: Boolean(row.has_clear_cta),
    has_testimonials: Boolean(row.has_testimonials),
    has_trust_badges: Boolean(row.has_trust_badges),
    page_load_time: row.page_load_time as number | null,
    owner_name: row.owner_name as string | null,
    owner_email: row.owner_email as string | null,
    owner_phone: row.owner_phone as string | null,
    owner_instagram: row.owner_instagram as string | null,
    owner_youtube: row.owner_youtube as string | null,
    owner_x: row.owner_x as string | null,
    owner_linkedin: row.owner_linkedin as string | null,
    owner_website: row.owner_website as string | null,
    discovery_source: row.discovery_source as string,
    search_query: row.search_query as string | null,
    page_title: row.page_title as string | null,
    page_description: row.page_description as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// ============ EMAIL ACCOUNT OPERATIONS ============

export interface EmailAccountRow {
  id: number;
  user_id: number;
  email_address: string;
  display_name: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_username: string | null;
  smtp_password_encrypted: string | null;
  auth_type: 'smtp' | 'oauth_gmail';
  oauth_access_token_encrypted: string | null;
  oauth_refresh_token_encrypted: string | null;
  oauth_token_expires_at: string | null;
  oauth_scope: string | null;
  is_active: boolean;
  daily_send_limit: number;
  sends_today: number;
  sends_reset_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getEmailAccountsByUserId(userId: number): Promise<EmailAccountRow[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to get email accounts: ${error.message}`);
  return (data || []) as EmailAccountRow[];
}

export async function getEmailAccountById(id: number, userId: number): Promise<EmailAccountRow | null> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get email account: ${error.message}`);
  }
  return data as EmailAccountRow;
}

export async function createEmailAccount(account: {
  user_id: number;
  email_address: string;
  display_name?: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password_encrypted: string;
}): Promise<EmailAccountRow> {
  const { data, error } = await supabase
    .from('email_accounts')
    .insert({
      user_id: account.user_id,
      email_address: account.email_address,
      display_name: account.display_name || null,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
      smtp_username: account.smtp_username,
      smtp_password_encrypted: account.smtp_password_encrypted,
      is_active: true,
      daily_send_limit: 50,
      sends_today: 0,
      last_verified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create email account: ${error.message}`);
  return data as EmailAccountRow;
}

export async function deleteEmailAccount(id: number, userId: number): Promise<void> {
  const { error } = await supabase
    .from('email_accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete email account: ${error.message}`);
}

export async function incrementSendCount(accountId: number): Promise<void> {
  // Check if sends need to be reset (new day)
  const account = await supabase
    .from('email_accounts')
    .select('sends_today, sends_reset_at')
    .eq('id', accountId)
    .single();

  if (account.data) {
    const resetAt = account.data.sends_reset_at ? new Date(account.data.sends_reset_at) : null;
    const now = new Date();

    if (!resetAt || now > resetAt) {
      // Reset counter and set next reset to tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      await supabase
        .from('email_accounts')
        .update({ sends_today: 1, sends_reset_at: tomorrow.toISOString() })
        .eq('id', accountId);
    } else {
      // Increment counter
      await supabase
        .from('email_accounts')
        .update({ sends_today: (account.data.sends_today || 0) + 1 })
        .eq('id', accountId);
    }
  }
}

// ============ SENT EMAIL OPERATIONS ============

export interface SentEmailRow {
  id: number;
  user_id: number;
  email_account_id: number;
  creator_id: number | null;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_html: string;
  message_id: string | null;
  status: string;
  error: string | null;
  sent_at: string;
  created_at: string;
}

export async function logSentEmail(email: {
  user_id: number;
  email_account_id: number;
  creator_id?: number | null;
  to_email: string;
  to_name?: string | null;
  subject: string;
  body_html: string;
  message_id?: string | null;
  status: string;
  error?: string | null;
}): Promise<SentEmailRow> {
  const { data, error } = await supabase
    .from('sent_emails')
    .insert({
      user_id: email.user_id,
      email_account_id: email.email_account_id,
      creator_id: email.creator_id || null,
      to_email: email.to_email,
      to_name: email.to_name || null,
      subject: email.subject,
      body_html: email.body_html,
      message_id: email.message_id || null,
      status: email.status,
      error: email.error || null,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to log sent email: ${error.message}`);
  return data as SentEmailRow;
}

export async function getSentEmailsByUserId(userId: number, limit: number = 50): Promise<SentEmailRow[]> {
  const { data, error } = await supabase
    .from('sent_emails')
    .select('*')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []) as SentEmailRow[];
}

// ============ STATS ============

export async function getDatabaseStats(): Promise<{ creators: number; funnels: number; jobs: number }> {
  const [creatorsResult, funnelsResult, jobsResult] = await Promise.all([
    supabase.from('creators').select('id', { count: 'exact', head: true }),
    supabase.from('funnels').select('id', { count: 'exact', head: true }),
    supabase.from('jobs').select('id', { count: 'exact', head: true })
  ]);

  return {
    creators: creatorsResult.count || 0,
    funnels: funnelsResult.count || 0,
    jobs: jobsResult.count || 0
  };
}
