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
  busy: 'Staying Busy',
  stress: 'Under Pressure',
};

const moodEmoji: Record<Mood, string> = {
  calm: '✨',
  busy: '⚡',
  stress: '🔥',
};

export default function Home() {
  const [priorities, setPriorities] = useState<Priority[]>([]);
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
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const spotlightRef = useRef<HTMLDivElement>(null);

  const fetchPriorities = useCallback(async (authPassword?: string) => {
    try {
      const headers: HeadersInit = {};
      if (authPassword) {
        headers['Authorization'] = `Bearer ${authPassword}`;
      }
      const res = await fetch('/api/priorities', { headers });
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

  const handleAuth = async () => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (res.ok) {
        setIsAuthenticated(true);
        setShowAuthModal(false);
        setAuthError('');
        // Refetch priorities with auth to get private labels
        fetchPriorities(password);
      } else {
        setAuthError('Invalid password');
      }
    } catch {
      setAuthError('Connection error');
    }
  };

  const savePriorities = async (newPriorities: Priority[]) => {
    try {
      await fetch('/api/priorities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${password}`,
        },
        body: JSON.stringify(newPriorities),
      });
      setPriorities(newPriorities);
    } catch (error) {
      console.error('Failed to save:', error);
    }
  };

  const addPriority = () => {
    const newPriority: Priority = {
      id: Date.now().toString(),
      label: 'New Priority',
      tag: 'misc',
      risk: 1,
      urgency: 1,
      importance: 2,
    };
    const updated = [...priorities, newPriority];
    savePriorities(updated);
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
    const inUse = priorities.some(p => p.tag === tagValue);
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
    const updated = priorities.map(p => 
      p.id === id ? { ...p, ...updates } : p
    );
    savePriorities(updated);
  };

  const deletePriority = (id: string) => {
    const updated = priorities.filter(p => p.id !== id);
    savePriorities(updated);
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

  const mood = calculateMood(priorities);
  const effectiveLoad = calculateEffectiveLoad(priorities);
  const loadPercent = Math.min((effectiveLoad / LOAD_THRESHOLDS.max) * 100, 100);
  
  // Sort priorities by weight (highest first for the list)
  const sortedPriorities = [...priorities].sort((a, b) => calculateWeight(b) - calculateWeight(a));
  
  // For the bar: sort ascending (smallest left, largest right)
  const barSegments = [...priorities]
    .map(p => ({ ...p, weight: calculateWeight(p) }))
    .sort((a, b) => a.weight - b.weight);

  // Generate particles
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 20}s`,
    duration: `${15 + Math.random() * 10}s`,
    size: `${2 + Math.random() * 4}px`,
  }));

  // Don't apply mood class until loaded to prevent flash
  const moodClass = isLoading ? '' : `mood-${mood}`;

  return (
    <div className={`min-h-screen relative ${moodClass} scanlines`}>
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
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12">
        <div className="float-container">
        {/* Header */}
        <header className="text-center mb-6">
          <h1 
            className="text-4xl md:text-5xl font-light tracking-tight mb-4 text-white"
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
              <span>{moodLabels[mood]}</span>
            </div>
          )}
          
          <p className={`mt-3 text-xs italic tracking-wide transition-opacity duration-500 ${
            (!isLoading && (mood === 'busy' || mood === 'stress')) ? 'text-white/40' : 'text-transparent'
          }`}>
            Attention is all you need.
          </p>
          
          {/* Load meter */}
          <div className={`mt-6 w-80 mx-auto transition-opacity duration-500 ${isLoading ? 'opacity-30' : 'opacity-100'}`}>
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
            <div className="flex justify-between mt-2 text-[11px] uppercase tracking-wider font-medium">
              <span className="text-[#00ff88]">🌴🍹 Calm</span>
              <span className="text-[#ffaa00]">💼 Busy</span>
              <span className="text-[#ff2244]">🚀 Stress</span>
            </div>
          </div>
        </header>

        {/* Priority list */}
        <div className="w-full max-w-lg mt-6">
          {isLoading ? (
            <div className="text-center text-white/40 py-12">
              <div className="inline-block w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : priorities.length === 0 ? (
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
                    ) : isAuthenticated && priority.label ? (
                      <div className="flex-1">
                        <span 
                          className="text-white cursor-text"
                          onClick={() => startEditing(priority)}
                        >
                          {priority.label}
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
                        className="text-white/30 hover:text-red-400 transition-colors px-2 opacity-0 group-hover:opacity-100 shrink-0"
                        title="Delete"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  
                  {/* Edit controls - shown below on hover */}
                  {isAuthenticated && editingId !== priority.id && (
                    <div className="flex flex-wrap gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
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
        <footer className="mt-16 flex gap-4">
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
                onClick={() => {
                  setIsAuthenticated(false);
                  setPassword('');
                  setEditingId(null);
                  // Refetch without auth to clear private labels from state
                  fetchPriorities();
                }}
                className="btn btn-ghost text-sm opacity-50 hover:opacity-80"
              >
                Exit Edit Mode
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
                const inUse = priorities.some(p => p.tag === tag.value);
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
