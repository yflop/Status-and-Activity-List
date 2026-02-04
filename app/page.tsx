'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Priority {
  id: string;
  label?: string;  // Only present when authenticated
  tag: string;
  risk: 1 | 2 | 3;
  urgency: 1 | 2 | 3;
  importance: 1 | 2 | 3;
}

type Mood = 'calm' | 'busy' | 'stress';

interface Tag {
  value: string;
  label: string;
}

// Weight multipliers - low items barely count, high items hit hard
const WEIGHT_MAP: Record<1 | 2 | 3, number> = {
  1: 0.5,  // Low - minimal impact
  2: 1.5,  // Medium - moderate impact  
  3: 3.0,  // High - significant impact
};

function calculateWeight(priority: Priority): number {
  return WEIGHT_MAP[priority.risk] + WEIGHT_MAP[priority.urgency] + WEIGHT_MAP[priority.importance];
}

function calculateEffectiveLoad(priorities: Priority[]): number {
  if (priorities.length === 0) return 0;
  return priorities.reduce((sum, p) => sum + calculateWeight(p), 0);
}

// Thresholds calibrated to current max load (~48)
const LOAD_THRESHOLDS = {
  calm: 15,    // Under 15 = feeling good
  busy: 35,    // 15-35 = staying busy
  max: 50,     // Visual max for the bar
};

function calculateMood(priorities: Priority[]): Mood {
  const effectiveLoad = calculateEffectiveLoad(priorities);
  
  if (effectiveLoad < LOAD_THRESHOLDS.calm) return 'calm';
  if (effectiveLoad < LOAD_THRESHOLDS.busy) return 'busy';
  return 'stress';
}

const moodLabels: Record<Mood, string> = {
  calm: 'Feeling Good',
  busy: 'Busy',
  stress: 'Under Pressure',
};

function getMoodLabel(mood: Mood, loadPercent: number): string {
  if (mood === 'busy' && loadPercent > 50) {
    return 'Very Busy';
  }
  return moodLabels[mood];
}

const moodEmoji: Record<Mood, string> = {
  calm: '✨',
  busy: '⚡',
  stress: '🔥',
};

export default function Home() {
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [draftPriorities, setDraftPriorities] = useState<Priority[] | null>(null); // null = not editing
  const [tags, setTags] = useState<Tag[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [authError, setAuthError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const [newTagLabel, setNewTagLabel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showGithubMenu, setShowGithubMenu] = useState(false);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const githubMenuRef = useRef<HTMLDivElement>(null);
  
  // Use draft priorities during edit mode, otherwise use saved priorities
  const activePriorities = draftPriorities ?? priorities;

  const fetchPriorities = useCallback(async (authPassword?: string) => {
    try {
      const headers: HeadersInit = {};
      if (authPassword) {
        headers['Authorization'] = `Bearer ${authPassword}`;
      }
      const res = await fetch('/api/priorities', { 
        headers,
        cache: 'no-store'
      });
      const data = await res.json();
      setPriorities(data);
    } catch (error) {
      console.error('Failed to fetch priorities:', error);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags');
      const data = await res.json();
      setTags(data);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchPriorities(), fetchTags()]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchPriorities, fetchTags]);

  // Mouse spotlight tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Close GitHub menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (githubMenuRef.current && !githubMenuRef.current.contains(e.target as Node)) {
        setShowGithubMenu(false);
      }
    };
    if (showGithubMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showGithubMenu]);

  const handleAuth = async () => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (res.ok) {
        // Refetch priorities with auth to get private labels
        const headers: HeadersInit = { 'Authorization': `Bearer ${password}` };
        const prioritiesRes = await fetch('/api/priorities', { headers, cache: 'no-store' });
        const freshPriorities = await prioritiesRes.json();
        
        // Set both priorities and draft in one go
        setPriorities(freshPriorities);
        setDraftPriorities([...freshPriorities]);
        setIsAuthenticated(true);
        setShowAuthModal(false);
        setAuthError('');
      } else {
        setAuthError('Invalid password');
      }
    } catch {
      setAuthError('Connection error');
    }
  };

  // Save all changes when exiting edit mode
  const exitEditMode = async () => {
    if (draftPriorities) {
      setIsSaving(true);
      try {
        await fetch('/api/priorities', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${password}`,
          },
          body: JSON.stringify(draftPriorities),
        });
      } catch (error) {
        console.error('Failed to save:', error);
      }
      setIsSaving(false);
    }
    
    setDraftPriorities(null);
    setIsAuthenticated(false);
    setPassword('');
    setEditingId(null);
    // Refetch without auth to clear private labels from state
    fetchPriorities();
  };

  const addPriority = () => {
    if (!draftPriorities) return;
    
    const newPriority: Priority = {
      id: Date.now().toString(),
      label: 'New Priority',
      tag: 'misc',
      risk: 1,
      urgency: 1,
      importance: 2,
    };
    // Add to draft (at the end, not re-sorted)
    setDraftPriorities([...draftPriorities, newPriority]);
    setEditingId(newPriority.id);
    setNewLabel('New Priority');
  };

  const getTagLabel = (tagValue: string) => {
    const tag = tags.find(t => t.value === tagValue);
    return tag ? tag.label : 'Miscellaneous';
  };

  const addTag = async () => {
    if (!newTagLabel.trim()) return;
    
    const tagValue = newTagValue.trim() 
      ? newTagValue.toLowerCase().replace(/\s+/g, '-')
      : newTagLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${password}`,
        },
        body: JSON.stringify({ 
          value: tagValue,
          label: newTagLabel 
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags);
        setNewTagValue('');
        setNewTagLabel('');
      }
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  };

  const deleteTag = async (tagValue: string) => {
    // Check if any priority uses this tag
    const inUse = activePriorities.some(p => p.tag === tagValue);
    if (inUse) {
      alert('Cannot delete tag that is in use. Reassign priorities first.');
      return;
    }
    
    try {
      const res = await fetch('/api/tags', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${password}`,
        },
        body: JSON.stringify({ value: tagValue }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags);
      }
    } catch (error) {
      console.error('Failed to delete tag:', error);
    }
  };

  const updatePriority = (id: string, updates: Partial<Priority>) => {
    if (!draftPriorities) return;
    
    const updated = draftPriorities.map(p => 
      p.id === id ? { ...p, ...updates } : p
    );
    setDraftPriorities(updated);
  };

  const deletePriority = (id: string) => {
    if (!draftPriorities) return;
    
    const updated = draftPriorities.filter(p => p.id !== id);
    setDraftPriorities(updated);
  };

  const startEditing = (priority: Priority) => {
    setEditingId(priority.id);
    setNewLabel(priority.label || '');
  };

  const finishEditing = () => {
    if (editingId && newLabel.trim()) {
      updatePriority(editingId, { label: newLabel.trim() });
    }
    setEditingId(null);
    setNewLabel('');
  };

  const mood = calculateMood(activePriorities);
  const effectiveLoad = calculateEffectiveLoad(activePriorities);
  const loadPercent = Math.min((effectiveLoad / LOAD_THRESHOLDS.max) * 100, 100);
  
  // Sort priorities by weight (highest first for the list)
  // Don't re-sort during edit mode to avoid UI jumping around
  const sortedPriorities = isAuthenticated 
    ? activePriorities 
    : [...activePriorities].sort((a, b) => calculateWeight(b) - calculateWeight(a));
  
  // For the bar: sort ascending (smallest left, largest right)
  const barSegments = [...activePriorities]
    .map(p => ({ ...p, weight: calculateWeight(p) }))
    .sort((a, b) => a.weight - b.weight);

  // Generate particles with stable values (seeded by index to avoid hydration mismatch)
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${(i * 17 + 7) % 100}%`,
    delay: `${(i * 3) % 20}s`,
    duration: `${15 + (i % 10)}s`,
    size: `${2 + (i % 4)}px`,
  }));

  // Don't apply mood class until loaded to prevent flash
  const moodClass = isLoading ? '' : `mood-${mood}`;

  return (
    <div className={`min-h-screen relative ${moodClass} scanlines`}>
      {/* Links - top right */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3">
        {/* Desktop: Show all links */}
        <a
          href="https://github.com/yflop/grantpeace.com/fork"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link group hidden sm:flex"
          title="Fork this project"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
          </svg>
          <span className="text-xs font-medium">Fork</span>
        </a>
        <a
          href="https://github.com/yflop"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link group hidden sm:flex"
          title="Follow me on GitHub"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
          </svg>
          <span className="text-xs font-medium">Follow</span>
        </a>

        {/* Mobile: GitHub dropdown */}
        <div className="relative flex sm:hidden" ref={githubMenuRef}>
          <button
            onClick={() => setShowGithubMenu(!showGithubMenu)}
            className="github-link flex"
            title="GitHub"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </button>
          {showGithubMenu && (
            <div className="absolute right-0 top-full mt-2 github-dropdown">
              <a
                href="https://github.com/yflop/grantpeace.com/fork"
                target="_blank"
                rel="noopener noreferrer"
                className="github-dropdown-item"
                onClick={() => setShowGithubMenu(false)}
              >
                Fork
              </a>
              <a
                href="https://github.com/yflop"
                target="_blank"
                rel="noopener noreferrer"
                className="github-dropdown-item"
                onClick={() => setShowGithubMenu(false)}
              >
                Follow
              </a>
            </div>
          )}
        </div>

        {/* Blog link - always visible */}
        <a
          href="https://openai.com.au"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link flex group"
          title="My fitness & nutrition blog"
        >
          {/* Lightning bolt icon - smaller but with padding to match button height */}
          <svg className="w-4 h-4 my-0.5" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#0a0a0a"/>
            <path d="M17.33 4L5 19h10l-1.33 9L26 13H16l1.33-9z" fill="#00FF88"/>
          </svg>
          <span className="hidden sm:inline text-xs font-medium">Blog</span>
        </a>

        {/* LinkedIn link */}
        <a
          href="https://linkedin.com/in/gap/"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link flex group"
          title="Connect on LinkedIn"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          <span className="hidden sm:inline text-xs font-medium">LinkedIn</span>
        </a>
      </div>

      {/* Spotlight following cursor */}
      <div 
        ref={spotlightRef}
        className="spotlight hidden md:block"
        style={{ left: mousePos.x, top: mousePos.y }}
      />
      
      {/* Aurora background */}
      <div className="aurora" />
      
      {/* Animated background */}
      <div className="bg-grid" />
      
      {/* Floating particles */}
      <div className="particles">
        {particles.map((p) => (
          <div
            key={p.id}
            className="particle"
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>
      
      {/* Horizon glow for depth */}
      <div className="horizon-glow" />
      
      {/* Vignette for depth */}
      <div className="vignette" />
      
      
      {/* Main content */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-start sm:justify-center px-2 sm:px-6 pt-16 sm:pt-0 pb-8 sm:py-12">
        <div className="float-container w-full flex flex-col items-center">
        {/* Header */}
        <header className="text-center mb-6">
          <h1 
            className="text-3xl sm:text-4xl md:text-5xl font-light tracking-tight mb-4 text-white"
            style={{ fontFamily: 'var(--font-geist-sans)' }}
          >
            Grant&apos;s Status
          </h1>
          {isLoading ? (
            <div className="status-badge text-xs opacity-50">
              <span>⏳</span>
              <span>Loading...</span>
            </div>
          ) : (
            <div className="status-badge text-xs">
              <span>{moodEmoji[mood]}</span>
              <span>{getMoodLabel(mood, loadPercent)}</span>
            </div>
          )}
          
          <p className={`mt-3 text-xs italic tracking-wide transition-opacity duration-500 ${
            (!isLoading && (mood === 'busy' || mood === 'stress')) ? 'text-white/40' : 'text-transparent'
          }`}>
            Attention is all you need.
          </p>
          
          {/* Load meter */}
          <div className={`mt-6 w-[92vw] sm:w-full sm:max-w-md md:max-w-lg mx-auto transition-opacity duration-500 ${isLoading ? 'opacity-30' : 'opacity-100'}`}>
            <div className="load-bar-container">
            <div className="relative h-4 bg-[#0a0a0f] rounded-full overflow-hidden">
              {/* Threshold markers - calm ends at 30%, busy ends at 70% */}
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-white/60 z-20"
                style={{ left: `${(LOAD_THRESHOLDS.calm / LOAD_THRESHOLDS.max) * 100}%` }}
                title="Busy threshold"
              />
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-white/60 z-20"
                style={{ left: `${(LOAD_THRESHOLDS.busy / LOAD_THRESHOLDS.max) * 100}%` }}
                title="Stress threshold"
              />
              
              {/* Segmented bar - each task gets a segment */}
              <div 
                className="absolute top-0 left-0 h-full flex transition-all duration-700"
                style={{ width: `${loadPercent}%` }}
              >
                {barSegments.map((segment, index) => {
                  // Each segment's width is proportional to its share of the total load
                  const segmentWidthPercent = effectiveLoad > 0 ? (segment.weight / effectiveLoad) * 100 : 0;
                  const segmentMood = segment.weight >= 6 ? 'stress' : segment.weight >= 3 ? 'busy' : 'calm';
                  return (
                    <div
                      key={segment.id}
                      className="h-full transition-all duration-300 relative cursor-pointer hover:brightness-125"
                      style={{
                        width: `${segmentWidthPercent}%`,
                        background: segmentMood === 'calm'
                          ? 'var(--accent-calm)'
                          : segmentMood === 'busy'
                            ? 'var(--accent-busy)'
                            : 'var(--accent-stress)',
                        opacity: 0.7 + (index / barSegments.length) * 0.3,
                        borderRight: index < barSegments.length - 1 ? '1px solid rgba(0,0,0,0.4)' : 'none',
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.2)`,
                      }}
                      title={isAuthenticated && segment.label ? `${segment.label} (${segment.weight.toFixed(1)})` : `${getTagLabel(segment.tag)} (${segment.weight.toFixed(1)})`}
                    />
                  );
                })}
              </div>
            </div>
            </div>
            
            {/* Labels */}
            <div className="flex justify-between mt-2 text-[10px] sm:text-[11px] uppercase tracking-wider font-medium">
              <span className="text-[#00ff88]">🌴 Calm</span>
              <span className="text-[#ffaa00]">💼 Busy</span>
              <span className="text-[#ff2244]">🚀 Stress</span>
            </div>
          </div>
        </header>

        {/* Priority list */}
        <div className="w-[92vw] sm:w-full sm:max-w-md md:max-w-lg mt-6">
          {isLoading ? (
            <div className="text-center text-white/40 py-12">
              <div className="inline-block w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : activePriorities.length === 0 ? (
            <div className="text-center text-white/60 py-12">
              <p className="text-lg mb-2">No priorities right now</p>
              <p className="text-sm text-white/40">Enjoying the calm ✨</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {sortedPriorities.map((priority, index) => (
                <li
                  key={priority.id}
                  className="priority-item group"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="flex items-center gap-3">
                    {/* Weight indicator dots */}
                    <div className="flex gap-1 shrink-0">
                      {Array.from({ length: Math.ceil(calculateWeight(priority) / 3) }).map((_, i) => (
                        <span 
                          key={i} 
                          className="weight-dot"
                          style={{ animationDelay: `${i * 0.2}s` }}
                        />
                      ))}
                    </div>
                    
                    {/* Label - shows actual label when authenticated, tag when public */}
                    {editingId === priority.id && isAuthenticated ? (
                      <input
                        type="text"
                        className="edit-input flex-1"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onBlur={finishEditing}
                        onKeyDown={(e) => e.key === 'Enter' && finishEditing()}
                        autoFocus
                        placeholder="Private task name..."
                      />
                    ) : isAuthenticated ? (
                      <div className="flex-1">
                        <span 
                          className="text-white cursor-text hover:text-white/80"
                          onClick={() => startEditing(priority)}
                        >
                          {priority.label || <span className="text-white/40 italic">Click to add label...</span>}
                        </span>
                        <span className="text-white/50 text-xs ml-2">
                          ({getTagLabel(priority.tag)})
                        </span>
                      </div>
                    ) : (
                      <span className="flex-1 text-white">
                        {getTagLabel(priority.tag)}
                      </span>
                    )}

                    {/* Delete button inline */}
                    {isAuthenticated && editingId !== priority.id && (
                      <button
                        onClick={() => deletePriority(priority.id)}
                        className="text-white/50 hover:text-red-400 transition-colors px-2 shrink-0"
                        title="Delete"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  
                  {/* Edit controls - always visible on mobile, hover on desktop */}
                  {isAuthenticated && editingId !== priority.id && (
                    <div className="flex flex-wrap gap-2 mt-3 transition-opacity" style={{ opacity: 1 }}>
                      <select
                        value={priority.tag}
                        onChange={(e) => updatePriority(priority.id, { tag: e.target.value })}
                        title="Public Tag"
                        className="text-xs"
                      >
                        {tags.map(tag => (
                          <option key={tag.value} value={tag.value}>{tag.label}</option>
                        ))}
                      </select>
                      <select
                        value={priority.urgency}
                        onChange={(e) => updatePriority(priority.id, { urgency: Number(e.target.value) as 1 | 2 | 3 })}
                        title="Urgency"
                        className="text-xs"
                      >
                        <option value={1}>Urgency: Low</option>
                        <option value={2}>Urgency: Medium</option>
                        <option value={3}>Urgency: High</option>
                      </select>
                      <select
                        value={priority.importance}
                        onChange={(e) => updatePriority(priority.id, { importance: Number(e.target.value) as 1 | 2 | 3 })}
                        title="Importance"
                        className="text-xs"
                      >
                        <option value={1}>Importance: Low</option>
                        <option value={2}>Importance: Medium</option>
                        <option value={3}>Importance: High</option>
                      </select>
                      <select
                        value={priority.risk}
                        onChange={(e) => updatePriority(priority.id, { risk: Number(e.target.value) as 1 | 2 | 3 })}
                        title="Risk"
                        className="text-xs"
                      >
                        <option value={1}>Risk: Low</option>
                        <option value={2}>Risk: Medium</option>
                        <option value={3}>Risk: High</option>
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add button (only when authenticated) */}
          {isAuthenticated && (
            <button
              onClick={addPriority}
              className="mt-6 w-full py-3 border border-dashed border-white/20 rounded-lg text-white/40 hover:text-white/70 hover:border-white/40 transition-all"
            >
              + Add Priority
            </button>
          )}
        </div>

        {/* Footer with edit toggle */}
        <footer className="mt-8 sm:mt-16 flex flex-col sm:flex-row gap-2 sm:gap-4 items-center justify-center w-full">
          {!isAuthenticated ? (
            <button
              onClick={() => setShowAuthModal(true)}
              className="btn btn-ghost text-sm opacity-30 hover:opacity-60"
            >
              Edit Mode
            </button>
          ) : (
            <>
              <button
                onClick={() => setShowTagModal(true)}
                className="btn btn-ghost text-sm opacity-50 hover:opacity-80"
              >
                Manage Tags
              </button>
              <button
                onClick={exitEditMode}
                disabled={isSaving}
                className="btn btn-ghost text-sm opacity-50 hover:opacity-80 disabled:opacity-30"
              >
                {isSaving ? 'Saving...' : 'Save & Exit'}
              </button>
            </>
          )}
        </footer>
        </div>
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <div 
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setShowAuthModal(false)}
        >
          <div className="modal-content">
            <h2 className="text-xl font-medium mb-4">Enter Password</h2>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              placeholder="Password"
              className="mb-4"
              autoFocus
            />
            {authError && (
              <p className="text-red-400 text-sm mb-4">{authError}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowAuthModal(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleAuth}
                className="btn btn-primary"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tag Management Modal */}
      {showTagModal && (
        <div 
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setShowTagModal(false)}
        >
          <div className="modal-content max-w-lg">
            <h2 className="text-xl font-medium mb-4">Manage Tags</h2>
            
            {/* Add new tag */}
            <div className="mb-6 p-4 bg-white/5 rounded-lg">
              <h3 className="text-sm font-medium text-white/60 mb-3">Add New Tag</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTagLabel}
                  onChange={(e) => setNewTagLabel(e.target.value)}
                  placeholder="Tag label (e.g., Client Meetings)"
                  className="flex-1"
                />
                <button
                  onClick={addTag}
                  disabled={!newTagLabel.trim()}
                  className="btn btn-primary disabled:opacity-30"
                >
                  Add
                </button>
              </div>
              <input
                type="text"
                value={newTagValue}
                onChange={(e) => setNewTagValue(e.target.value)}
                placeholder="Tag ID (optional, auto-generated)"
                className="mt-2 text-sm opacity-60"
              />
            </div>
            
            {/* Existing tags */}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {tags.map(tag => {
                const inUse = activePriorities.some(p => p.tag === tag.value);
                return (
                  <div 
                    key={tag.value}
                    className="flex items-center justify-between p-2 bg-white/5 rounded group"
                  >
                    <div>
                      <span className="text-white/90">{tag.label}</span>
                      <span className="text-white/30 text-xs ml-2">({tag.value})</span>
                      {inUse && (
                        <span className="text-amber-400/60 text-xs ml-2">• in use</span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTag(tag.value)}
                      disabled={inUse}
                      className="text-white/30 hover:text-red-400 transition-colors px-2 disabled:opacity-20 disabled:cursor-not-allowed"
                      title={inUse ? 'Cannot delete - tag is in use' : 'Delete tag'}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowTagModal(false)}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
