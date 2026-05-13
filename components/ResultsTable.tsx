'use client';

import { useState, useEffect } from 'react';

type Platform = 'youtube' | 'instagram' | 'x' | 'tiktok' | 'linkedin' | 'skool' | 'substack';

interface Creator {
  id: number;
  platform?: Platform;
  platformId?: string;
  username?: string | null;
  displayName?: string;
  profileUrl?: string;
  followers?: number;
  following?: number;
  postCount?: number;
  totalViews?: number;
  engagementRate?: number;
  bio?: string | null;
  externalUrl?: string | null;
  qualified: boolean;
  qualificationReason: string;
  email: string | null;
  firstName: string | null;
  channelId?: string;
  channelName?: string;
  channelUrl?: string;
  subscribers?: number;
  videoCount?: number;
}

interface Summary {
  total: number;
  qualified: number;
  withEmail: number;
}

interface ResultsTableProps {
  creators: Creator[];
  summary: Summary;
  jobId: string;
  showAll?: boolean;
  platform?: Platform;
  onFindMore?: () => void;
  isFindingMore?: boolean;
  jobStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSendEmail?: (creator: any) => void;
  onBulkOutreach?: (creators: Creator[]) => void;
}

type SortField = 'displayName' | 'followers' | 'postCount' | 'qualified';
type SortDirection = 'asc' | 'desc';

const PLATFORM_CONFIG: Record<Platform, { name: string; followersLabel: string; postsLabel: string }> = {
  youtube: { name: 'YouTube', followersLabel: 'Subs', postsLabel: 'Videos' },
  instagram: { name: 'Instagram', followersLabel: 'Followers', postsLabel: 'Posts' },
  x: { name: 'X', followersLabel: 'Followers', postsLabel: 'Posts' },
  tiktok: { name: 'TikTok', followersLabel: 'Followers', postsLabel: 'Videos' },
  linkedin: { name: 'LinkedIn', followersLabel: 'Connections', postsLabel: 'Posts' },
  skool: { name: 'Skool', followersLabel: 'Members', postsLabel: 'Posts' },
  substack: { name: 'Substack', followersLabel: 'Subscribers', postsLabel: 'Posts' },
};

// SVG icons for each platform
const PlatformIcon = ({ platform, className = "w-5 h-5" }: { platform: Platform; className?: string }) => {
  switch (platform) {
    case 'youtube':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      );
    case 'instagram':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
      );
    case 'x':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      );
    case 'tiktok':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
        </svg>
      );
    case 'linkedin':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      );
    case 'skool':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/>
        </svg>
      );
    case 'substack':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24l9.54-7.636V10.812H1.46zm12 5.552L22.539 24V10.812h-9.08v5.552zM22.54 0H1.46v2.836h21.08V0z"/>
        </svg>
      );
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4l3 3" />
        </svg>
      );
  }
};

export default function ResultsTable({ creators, summary, jobId, platform = 'youtube', onFindMore, isFindingMore, jobStatus, onSendEmail, onBulkOutreach }: ResultsTableProps) {
  const [sortField, setSortField] = useState<SortField>('followers');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterQualified, setFilterQualified] = useState(true);
  const [visibleRows, setVisibleRows] = useState<Set<number>>(new Set());
  const [showCelebration, setShowCelebration] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const config = PLATFORM_CONFIG[platform];

  // Stagger row animations
  useEffect(() => {
    const filteredCreators = filterQualified ? creators.filter(c => c.qualified) : creators;
    filteredCreators.forEach((creator, index) => {
      setTimeout(() => {
        setVisibleRows(prev => new Set([...prev, creator.id]));
      }, index * 50); // 50ms stagger
    });
  }, [creators, filterQualified]);

  // Celebration effect when we have gold moments
  useEffect(() => {
    if (summary.withEmail > 0 && jobStatus === 'completed') {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 2000);
    }
  }, [summary.withEmail, jobStatus]);

  const getDisplayName = (c: Creator) => {
    if (c.username && (!c.displayName || c.displayName === 'Unknown')) {
      return `@${c.username}`;
    }
    return c.displayName || c.channelName || 'Unknown';
  };

  const getProfileUrl = (c: Creator) => {
    if (c.profileUrl) return c.profileUrl;
    if (c.channelUrl) return c.channelUrl;
    if (c.username) return `https://instagram.com/${c.username}`;
    return '#';
  };

  const getFollowers = (c: Creator) => c.followers || c.subscribers || 0;
  const getPostCount = (c: Creator) => c.postCount || c.videoCount || 0;
  const getUsername = (c: Creator) => c.username || null;

  const filteredCreators = filterQualified
    ? creators.filter((c) => c.qualified)
    : creators;

  const sortedCreators = [...filteredCreators].sort((a, b) => {
    let aVal: string | number | boolean;
    let bVal: string | number | boolean;

    switch (sortField) {
      case 'displayName':
        aVal = getDisplayName(a).toLowerCase();
        bVal = getDisplayName(b).toLowerCase();
        break;
      case 'followers':
        aVal = getFollowers(a);
        bVal = getFollowers(b);
        break;
      case 'postCount':
        aVal = getPostCount(a);
        bVal = getPostCount(b);
        break;
      case 'qualified':
        aVal = a.qualified;
        bVal = b.qualified;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-[var(--text-muted)] ml-1 opacity-50">&#8645;</span>;
    }
    return (
      <span className="ml-1 text-[var(--accent)]">
        {sortDirection === 'asc' ? '\u2191' : '\u2193'}
      </span>
    );
  };

  const isGoldMoment = (creator: Creator) => creator.qualified && creator.email;

  const getCreatorPlatform = (c: Creator) => c.platform || platform;

  // Selection logic
  const creatorsWithEmail = sortedCreators.filter(c => c.email);
  const allEmailSelected = creatorsWithEmail.length > 0 && creatorsWithEmail.every(c => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = () => {
    if (allEmailSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(creatorsWithEmail.map(c => c.id)));
    }
  };

  const handleSelectOne = (creator: Creator) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(creator.id)) {
        next.delete(creator.id);
      } else {
        next.add(creator.id);
      }
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkOutreach = () => {
    if (onBulkOutreach) {
      const selected = creators.filter(c => selectedIds.has(c.id));
      onBulkOutreach(selected);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards - The "Jackpot" Display */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-shadow">
          <div className="text-4xl font-mono font-bold text-[var(--text-primary)] mb-1">{summary.total}</div>
          <div className="text-sm text-[var(--text-muted)]">Creators Found</div>
        </div>
        <div className="bg-[var(--status-success-light)] border border-[var(--status-success)] rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-shadow">
          <div className="text-4xl font-mono font-bold text-[var(--status-success)] mb-1">{summary.qualified}</div>
          <div className="text-sm text-[var(--status-success)]">Qualified</div>
        </div>
        <div className={`relative overflow-hidden rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-all ${
          summary.withEmail > 0
            ? 'bg-gradient-to-br from-[var(--accent-light)] to-emerald-100 border-2 border-[var(--accent)]'
            : 'bg-[var(--bg-primary)] border border-[var(--border-default)]'
        }`}>
          {/* Celebration particles */}
          {showCelebration && (
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-[var(--accent)]"
                  style={{
                    left: `${20 + Math.random() * 60}%`,
                    top: `${20 + Math.random() * 60}%`,
                    animation: `ping 1s ease-out ${i * 0.1}s forwards`,
                    opacity: 0,
                  }}
                />
              ))}
            </div>
          )}
          <div className={`text-4xl font-mono font-bold mb-1 ${summary.withEmail > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
            {summary.withEmail}
          </div>
          <div className={`text-sm ${summary.withEmail > 0 ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-muted)]'}`}>
            Ready to Contact
          </div>
          {summary.withEmail > 0 && (
            <div className="absolute top-2 right-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-xs font-medium">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                Jackpot
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => setFilterQualified(!filterQualified)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 text-sm font-medium ${
            filterQualified
              ? 'bg-[var(--status-success-light)] border-[var(--status-success)] text-[var(--status-success)]'
              : 'bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-emphasized)]'
          }`}
        >
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
            filterQualified ? 'bg-[var(--status-success)] border-[var(--status-success)]' : 'border-[var(--text-muted)]'
          }`}>
            {filterQualified && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          Show qualified only
        </button>

        <div className="flex items-center gap-3">
          {onFindMore && jobStatus === 'completed' && (
            <button
              onClick={onFindMore}
              disabled={isFindingMore}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white font-medium text-sm hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFindingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Finding more...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Find More Creators
                </>
              )}
            </button>
          )}

          <a
            href={`/api/export/${jobId}`}
            download
            className="group flex items-center gap-2 px-6 py-2.5 rounded-xl border-2 border-[var(--text-primary)] bg-[var(--text-primary)] text-white font-medium text-sm hover:bg-transparent hover:text-[var(--text-primary)] transition-all"
          >
            <svg className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </a>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[var(--bg-subtle)] border-b border-[var(--border-default)]">
                <th className="px-4 py-4 text-center w-12">
                  <input
                    type="checkbox"
                    className="custom-checkbox"
                    checked={allEmailSelected}
                    onChange={handleSelectAll}
                    disabled={creatorsWithEmail.length === 0}
                    title={creatorsWithEmail.length === 0 ? 'No creators with emails' : 'Select all with emails'}
                  />
                </th>
                <th onClick={() => handleSort('displayName')} className="px-6 py-4 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                  {platform === 'youtube' ? 'Channel' : 'Creator'} <SortIcon field="displayName" />
                </th>
                <th onClick={() => handleSort('followers')} className="px-6 py-4 text-right text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                  {config.followersLabel} <SortIcon field="followers" />
                </th>
                <th onClick={() => handleSort('postCount')} className="px-6 py-4 text-right text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                  {config.postsLabel} <SortIcon field="postCount" />
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Contact</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Why They Fit</th>
              </tr>
            </thead>
            <tbody>
              {sortedCreators.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="text-[var(--text-muted)]">
                      <svg className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                      </svg>
                      <div className="font-medium text-lg">No creators match current filters</div>
                      <div className="text-sm mt-2">Try toggling the &quot;Show qualified only&quot; filter</div>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedCreators.map((creator, index) => {
                  const gold = isGoldMoment(creator);
                  const isVisible = visibleRows.has(creator.id);
                  const isSelected = selectedIds.has(creator.id);
                  const hasEmail = !!creator.email;

                  return (
                    <tr
                      key={creator.id}
                      className={`
                        border-b border-[var(--border-subtle)] last:border-b-0
                        transition-all duration-300 ease-out
                        ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}
                        ${isSelected
                          ? 'row-selected'
                          : gold
                            ? 'bg-gradient-to-r from-[var(--accent-light)] via-emerald-50 to-transparent hover:from-emerald-100'
                            : 'hover:bg-[var(--bg-subtle)]'
                        }
                      `}
                      style={{
                        transitionDelay: `${index * 30}ms`,
                      }}
                    >
                      <td className="px-4 py-4 text-center w-12">
                        <input
                          type="checkbox"
                          className="custom-checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectOne(creator)}
                          disabled={!hasEmail}
                          title={hasEmail ? `Select ${getDisplayName(creator)}` : 'No email available'}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            gold ? 'bg-[var(--accent)] text-white shadow-lg shadow-emerald-200' : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                          }`}>
                            <PlatformIcon platform={getCreatorPlatform(creator)} />
                          </div>
                          <div>
                            <a
                              href={getProfileUrl(creator)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`font-medium transition-colors ${
                                gold
                                  ? 'text-[var(--accent)] hover:text-[var(--accent-hover)]'
                                  : 'text-[var(--text-primary)] hover:text-[var(--accent)]'
                              }`}
                            >
                              {getDisplayName(creator)}
                            </a>
                            {getUsername(creator) && (
                              <div className="text-xs text-[var(--text-muted)]">@{getUsername(creator)}</div>
                            )}
                          </div>
                          {gold && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-xs font-medium animate-pulse">
                              &#10024; Hot Lead
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="font-mono font-medium text-[var(--text-primary)]">
                          {formatNumber(getFollowers(creator))}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="font-mono text-[var(--text-secondary)]">{getPostCount(creator)}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {creator.email ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onSendEmail && onSendEmail(creator)}
                              className="inline-flex items-center gap-2 text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors cursor-pointer"
                              title="Send outreach email"
                            >
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              <span className="font-mono text-sm">{creator.email}</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[var(--text-muted)] text-sm">No email found</span>
                        )}
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <span className="text-sm text-[var(--text-secondary)] line-clamp-2">
                          {creator.qualificationReason}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--text-muted)]">
          Showing <span className="font-medium text-[var(--text-secondary)]">{sortedCreators.length}</span> of{' '}
          <span className="font-medium text-[var(--text-secondary)]">{creators.length}</span> creators
        </span>

        {onFindMore && jobStatus === 'completed' && (
          <button
            onClick={onFindMore}
            disabled={isFindingMore}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--bg-primary)] border-2 border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFindingMore ? (
              <>
                <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                Finding more...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Find More Creators
              </>
            )}
          </button>
        )}
      </div>

      {/* Floating Action Bar */}
      {someSelected && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slideUp"
        >
          <div
            className="flex items-center gap-6 px-6 py-3.5 rounded-2xl shadow-lg border border-[var(--accent-border)]"
            style={{
              background: 'var(--bg-primary)',
              boxShadow: '0 8px 32px rgba(16, 185, 129, 0.18), 0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <span className="text-sm font-medium text-[var(--text-primary)] whitespace-nowrap">
              <span className="text-[var(--accent)] font-bold">{selectedIds.size}</span> creator{selectedIds.size !== 1 ? 's' : ''} selected
            </span>

            <button
              onClick={handleDeselectAll}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
            >
              Deselect All
            </button>

            <button
              onClick={handleBulkOutreach}
              className="btn-accent text-sm px-5 py-2 whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              Send Outreach
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
