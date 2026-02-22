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

interface FlowTask {
  id: string;
  label: string;
  difficulty: 1 | 2 | 3;
}

interface FlowCompletion {
  difficulty: 1 | 2 | 3;
  completedAt: number;
}

const DIFFICULTY_HOURS: Record<1 | 2 | 3, number> = { 1: 4, 2: 8, 3: 12 };

const FLOW_GRANT: Record<1 | 2 | 3, number> = { 1: 33, 2: 43, 3: 53 };

function calculateFlowPercent(completions: FlowCompletion[]): number {
  const now = Date.now();
  let total = 0;
  for (const c of completions) {
    const durationMs = (DIFFICULTY_HOURS[c.difficulty] || 4) * 3600_000;
    const elapsed = now - c.completedAt;
    if (elapsed < durationMs) {
      const grant = FLOW_GRANT[c.difficulty] || 33;
      total += grant * (1 - elapsed / durationMs);
    }
  }
  return Math.min(100, total);
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
  const [cursorUsage, setCursorUsage] = useState<{ tokens: number; linesOfCode: number } | null>(null);
  const [displayedTokens, setDisplayedTokens] = useState<number>(0);
  const [displayedLines, setDisplayedLines] = useState<number>(0);
  const displayedTokensRef = useRef<number>(0);
  const displayedLinesRef = useRef<number>(0);
  const targetTokensRef = useRef<number>(0);
  const targetLinesRef = useRef<number>(0);
  const tokenStartRef = useRef<number>(0);
  const linesStartRef = useRef<number>(0);
  const floorTokensRef = useRef<number>(0);
  const floorLinesRef = useRef<number>(0);
  const lineSeqIndexRef = useRef<number>(0);
  const lineTokenAccumRef = useRef<number>(0);
  const wasInCatchUpRef = useRef<boolean>(true);
  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const lastSaveTimeRef = useRef<number>(0);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const githubMenuRef = useRef<HTMLDivElement>(null);

  // Flowkeeper state
  const [flowTasks, setFlowTasks] = useState<FlowTask[]>([]);
  const [draftFlowTasks, setDraftFlowTasks] = useState<FlowTask[] | null>(null);
  const [flowCompletions, setFlowCompletions] = useState<FlowCompletion[]>([]);
  const [flowPercent, setFlowPercent] = useState(0);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [newFlowLabel, setNewFlowLabel] = useState('');
  const [hasRecentLogin, setHasRecentLogin] = useState(false);
  const completingIdsRef = useRef<Set<string>>(new Set());
  
  // Use draft priorities during edit mode, otherwise use saved priorities
  const activePriorities = draftPriorities ?? priorities;
  const activeFlowTasks = draftFlowTasks ?? flowTasks;

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

  const fetchFlowkeeper = useCallback(async () => {
    try {
      const res = await fetch('/api/flowkeeper');
      const data = await res.json();
      setFlowTasks(data.tasks || []);
      setFlowCompletions(data.completions || []);
      setFlowPercent(calculateFlowPercent(data.completions || []));
    } catch (error) {
      console.error('Failed to fetch flowkeeper:', error);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchPriorities(), fetchTags(), fetchFlowkeeper()]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchPriorities, fetchTags, fetchFlowkeeper]);

  // Check for recent login (24h window) on mount
  useEffect(() => {
    const lastLogin = Number(localStorage.getItem('last_login_at') || '0');
    if (Date.now() - lastLogin < 24 * 60 * 60 * 1000) {
      setHasRecentLogin(true);
    }
  }, []);

  // Recalculate flow percent at high frequency for smooth decay
  useEffect(() => {
    if (flowCompletions.length === 0) {
      setFlowPercent(0);
      return;
    }
    const tick = () => setFlowPercent(calculateFlowPercent(flowCompletions));
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [flowCompletions]);

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
        setDraftFlowTasks([...flowTasks]);
        setIsAuthenticated(true);
        setHasRecentLogin(true);
        localStorage.setItem('last_login_at', String(Date.now()));
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
    // Snapshot drafts and password before clearing state
    const savedPriorities = draftPriorities;
    const savedFlowTasks = draftFlowTasks;
    const pw = password;

    // Promote drafts to canonical state immediately so the UI never flashes stale data
    if (savedPriorities) {
      const publicView = savedPriorities.map(({ id, tag, risk, urgency, importance }) => ({
        id, tag, risk, urgency, importance,
      })) as Priority[];
      setPriorities(publicView);
    }
    if (savedFlowTasks) {
      setFlowTasks([...savedFlowTasks]);
    }

    setDraftPriorities(null);
    setDraftFlowTasks(null);
    setIsAuthenticated(false);
    setPassword('');
    setEditingId(null);
    setEditingFlowId(null);

    // Save to server in background (non-blocking)
    setIsSaving(true);
    const saves: Promise<Response>[] = [];
    if (savedPriorities) {
      saves.push(fetch('/api/priorities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pw}` },
        body: JSON.stringify(savedPriorities),
      }));
    }
    if (savedFlowTasks) {
      saves.push(fetch('/api/flowkeeper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pw}` },
        body: JSON.stringify(savedFlowTasks),
      }));
    }

    try {
      await Promise.all(saves);
    } catch (error) {
      console.error('Failed to save:', error);
    }
    setIsSaving(false);
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

  // --- Flowkeeper task functions ---

  const addFlowTask = () => {
    if (!draftFlowTasks) return;
    const task: FlowTask = { id: Date.now().toString(), label: 'New task', difficulty: 1 };
    setDraftFlowTasks([...draftFlowTasks, task]);
    setEditingFlowId(task.id);
    setNewFlowLabel('New task');
  };

  const updateFlowTask = (id: string, updates: Partial<FlowTask>) => {
    if (!draftFlowTasks) return;
    setDraftFlowTasks(draftFlowTasks.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const deleteFlowTask = (id: string) => {
    if (!draftFlowTasks) return;
    setDraftFlowTasks(draftFlowTasks.filter(t => t.id !== id));
  };

  const completeFlowTask = async (id: string) => {
    if (completingIdsRef.current.has(id)) return;
    completingIdsRef.current.add(id);

    // Find task before removing so we know its difficulty
    const allTasks = draftFlowTasks ?? flowTasks;
    const task = allTasks.find(t => t.id === id);

    // Optimistic: remove from UI and bump flow immediately
    if (draftFlowTasks) {
      setDraftFlowTasks(prev => prev ? prev.filter(t => t.id !== id) : null);
    }
    setFlowTasks(prev => prev.filter(t => t.id !== id));

    if (task) {
      const newCompletion: FlowCompletion = { difficulty: task.difficulty, completedAt: Date.now() };
      setFlowCompletions(prev => {
        const updated = [...prev, newCompletion];
        setFlowPercent(calculateFlowPercent(updated));
        return updated;
      });
    }

    // Fire the API call in the background
    try {
      await fetch('/api/flowkeeper/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${password}` },
        body: JSON.stringify({ id }),
      });
    } catch (error) {
      console.error('Failed to complete flow task:', error);
    } finally {
      completingIdsRef.current.delete(id);
    }
  };

  const startEditingFlow = (task: FlowTask) => {
    setEditingFlowId(task.id);
    setNewFlowLabel(task.label);
  };

  const finishEditingFlow = () => {
    if (editingFlowId && newFlowLabel.trim()) {
      updateFlowTask(editingFlowId, { label: newFlowLabel.trim() });
    }
    setEditingFlowId(null);
    setNewFlowLabel('');
  };

  const difficultyLabel = (d: 1 | 2 | 3) => d === 1 ? 'Easy' : d === 2 ? 'Medium' : 'Hard';

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

  // Social media log: generated client-side to avoid hydration mismatch
  const [socialMediaLog, setSocialMediaLog] = useState<{ date: string; minutes: number }[]>([]);
  useEffect(() => {
    const entries = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return {
        date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        minutes: 0,
      };
    });
    setSocialMediaLog(entries);
  }, []);

  // Animation constants
  const TOKEN_BUFFER = 50_000_000; // 50M buffer behind actual
  const POLL_INTERVAL = 30_000; // Poll every 30s (Blob updated every minute by cron)
  const RAMP_SECONDS = 35;
  const SAVE_LAG_TOKENS = 500_000; // Save localStorage 500K behind displayed
  const STORAGE_KEY_TOKENS = 'cursor_tokens_highest';
  const STORAGE_KEY_LINES = 'cursor_lines_highest';
  const tokensPerLineRatioRef = useRef<number>(21_000); // default, updated from data

  // Tokens-per-line sequence for realistic line pacing
  const LINE_TOKEN_SEQ = [
    10,0,13,0,4,25,21,22,0,7,12,18,1,0,10,11,1,0,11,0,4,7,8,1,0,24,3,20,6,4,8,9,2,10,2,0,15,7,14,2,0,8,8,6,4,3,2,1,0,9,0,4,5,6,6,7,7,7,2,8,1,0,5,8,4,6,5,5,6,2,8,1,0,7,5,5,5,5,5,10,3,20,6,4,8,9,2,14,2,0,15,7,19,2,0,9,6,4,4,2,1,0,11,18,8,7,7,0,6,17,12,0,11,8,14,14,2,2,0,10,3,0,10,6,2,0,5,1,0,9,12,10,0,12,6,19,2,0,10,22,9,2,0,7,21,25,0,7,18,9,8,13,14,5,2,0,10,8,0,15,20,13,0,10,9,16,2,11,10,15,2,2,0,8,7,0,15,9,17,6,2,0,5,12,7,2,2,0,5,10,10,7,2,0,6,7,1
  ];

  const SEQ_AVG = LINE_TOKEN_SEQ.reduce((a, b) => a + b, 0) / LINE_TOKEN_SEQ.length;
  const LINE_COST_MULTIPLIER = 200; // Each sequence value costs this many display tokens
  const VISUAL_TOKENS_PER_LINE = SEQ_AVG * LINE_COST_MULTIPLIER; // ~1,428 display tokens per line

  // Refs for random pauses and speed variation
  const isPausedRef = useRef(false);
  const pauseEndRef = useRef<number>(0);
  const nextPauseAtRef = useRef<number>(0);
  const speedMultiplierRef = useRef<number>(1);
  const speedChangeAtRef = useRef<number>(0);

  // Fetch actuals and update targets
  const fetchAndUpdateUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/cursor-usage');
      const data = await res.json();
      if (data.tokens === undefined && data.linesOfCode === undefined) return;
      setCursorUsage(data);

      const storedTokens = Number(localStorage.getItem(STORAGE_KEY_TOKENS) || '0');
      const storedLines = Number(localStorage.getItem(STORAGE_KEY_LINES) || '0');

      // Update data ratio for catch-up mode
      if (data.linesOfCode > 0) {
        tokensPerLineRatioRef.current = data.tokens / data.linesOfCode;
      }

      // Lines buffer based on VISUAL sequence rate (so lines last as long as tokens)
      const linesBuffer = Math.round(TOKEN_BUFFER / VISUAL_TOKENS_PER_LINE);

      // Targets: actual minus buffer, but never below current target (only goes up)
      const tokenTarget = Math.max(data.tokens - TOKEN_BUFFER, targetTokensRef.current);
      const linesTarget = Math.max(data.linesOfCode - linesBuffer, targetLinesRef.current);

      // Record start positions for proportional line tracking
      tokenStartRef.current = displayedTokensRef.current;
      linesStartRef.current = displayedLinesRef.current;

      targetTokensRef.current = tokenTarget;
      targetLinesRef.current = linesTarget;

      // Initialize on first load
      if (floorTokensRef.current === 0 && floorLinesRef.current === 0 && 
          displayedTokensRef.current === 0) {
        floorTokensRef.current = storedTokens;
        floorLinesRef.current = storedLines;

        // Start from localStorage value (or 0 for first-time visitors)
        // Fast catch-up will race from here to the normal zone
        displayedTokensRef.current = storedTokens;
        tokenStartRef.current = storedTokens;
        setDisplayedTokens(storedTokens);

        displayedLinesRef.current = storedLines;
        linesStartRef.current = storedLines;
        setDisplayedLines(storedLines);
      }

      // Reset sequence accumulator on new targets
      lineTokenAccumRef.current = 0;
    } catch (err) {
      console.error('Failed to fetch Cursor usage:', err);
    }
  }, []);

  // Animation loop
  useEffect(() => {
    // Schedule the first pause randomly 10–60s in the future
    nextPauseAtRef.current = performance.now() + 10_000 + Math.random() * 50_000;
    speedChangeAtRef.current = performance.now() + 5_000 + Math.random() * 15_000;
    speedMultiplierRef.current = 0.3 + Math.random() * 2.7; // 0.3x – 3.0x

    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp;
      }
      const deltaMs = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      // --- Random pause logic (only in normal zone, not during fast catch-up) ---
      const inNormalZone = targetTokensRef.current > 0 && 
        (targetTokensRef.current - displayedTokensRef.current) <= SAVE_LAG_TOKENS;

      if (inNormalZone) {
        if (isPausedRef.current) {
          if (timestamp >= pauseEndRef.current) {
            isPausedRef.current = false;
            nextPauseAtRef.current = timestamp + 30_000 + Math.random() * 270_000;
          } else {
            animFrameRef.current = requestAnimationFrame(animate);
            return; // Paused — skip this frame
          }
        } else if (timestamp >= nextPauseAtRef.current) {
          isPausedRef.current = true;
          pauseEndRef.current = timestamp + 300 + Math.random() * 4700;
          animFrameRef.current = requestAnimationFrame(animate);
          return;
        }
      } else {
        // Reset pause state during catch-up so it doesn't trigger immediately after
        isPausedRef.current = false;
      }

      // --- Random speed variation ---
      if (timestamp >= speedChangeAtRef.current) {
        // New multiplier between 0.3x and 3.0x
        speedMultiplierRef.current = 0.3 + Math.random() * 2.7;
        // Change speed again in 5–20 seconds
        speedChangeAtRef.current = timestamp + 5_000 + Math.random() * 15_000;
      }

      const speedMult = speedMultiplierRef.current;

      const MAX_TOKENS_PER_MS = 1.5; // 1500 tokens/sec cap for normal zone
      const NORMAL_ZONE = SAVE_LAG_TOKENS; // Within 500K of target = normal speed
      let tokensChanged = false;
      let linesChanged = false;

      // --- Animate tokens ---
      const tokenGap = targetTokensRef.current - displayedTokensRef.current;
      let tokenInc = 0;
      const inCatchUp = tokenGap > NORMAL_ZONE;

      if (tokenGap > 0) {
        if (inCatchUp) {
          // Fast catch-up zone: speed through to reach normal zone
          const catchUpSpeed = Math.max(tokenGap / (3 * 1000), 500);
          tokenInc = catchUpSpeed * deltaMs;
        } else {
          // Transition: just entered normal zone — reset with proportional line headroom
          if (wasInCatchUpRef.current) {
            wasInCatchUpRef.current = false;
            tokenStartRef.current = displayedTokensRef.current;
            lineTokenAccumRef.current = 0;

            // Force remaining lines to match tokens at the visual sequence rate
            const remainingTokens = targetTokensRef.current - displayedTokensRef.current;
            const proportionalLinesRemaining = remainingTokens / VISUAL_TOKENS_PER_LINE;
            linesStartRef.current = targetLinesRef.current - proportionalLinesRemaining;
            // Pull displayed lines back if needed so there's room to animate
            if (displayedLinesRef.current > linesStartRef.current) {
              displayedLinesRef.current = linesStartRef.current;
            }
          }
          // Normal zone: base speed capped at 1500/sec, then multiplied by 0.3x–3.0x
          const baseTokenSpeed = Math.min(
            Math.max(tokenGap / (RAMP_SECONDS * 1000), 0.1),
            MAX_TOKENS_PER_MS
          );
          tokenInc = baseTokenSpeed * deltaMs * speedMult;
        }

        const newTokens = Math.min(displayedTokensRef.current + tokenInc, targetTokensRef.current);
        displayedTokensRef.current = newTokens;
        tokensChanged = true;
      }

      // --- Animate lines ---
      if (tokenInc > 0 && displayedLinesRef.current < targetLinesRef.current) {
        if (inCatchUp) {
          // During catch-up: move lines proportionally with tokens (no sequence)
          const lineInc = tokenInc / tokensPerLineRatioRef.current;
          displayedLinesRef.current = Math.min(
            displayedLinesRef.current + lineInc,
            targetLinesRef.current
          );
          linesChanged = true;
        } else {
          // Normal zone: sequence-driven pacing
          // Each line costs SEQ[i] * LINE_COST_MULTIPLIER display tokens

          // Feed raw token increment into accumulator
          lineTokenAccumRef.current += tokenInc;

          let linesAdded = 0;
          while (displayedLinesRef.current + linesAdded < targetLinesRef.current) {
            const seqIdx = lineSeqIndexRef.current % LINE_TOKEN_SEQ.length;
            const rawCost = LINE_TOKEN_SEQ[seqIdx];
            const cost = rawCost * LINE_COST_MULTIPLIER;

            // 0-cost lines appear instantly (blank/comment lines)
            if (rawCost === 0 || lineTokenAccumRef.current >= cost) {
              lineTokenAccumRef.current -= cost;
              linesAdded++;
              lineSeqIndexRef.current++;
            } else {
              break;
            }
          }

          if (linesAdded > 0) {
            displayedLinesRef.current += linesAdded;
            linesChanged = true;
          }
        }
      }

      // Batch React state updates — display = max(animated, floor)
      if (tokensChanged || linesChanged) {
        const animTokens = Math.floor(displayedTokensRef.current);
        const animLines = Math.floor(displayedLinesRef.current);

        if (tokensChanged) {
          const visibleTokens = Math.max(animTokens, floorTokensRef.current);
          setDisplayedTokens(visibleTokens);
          // Update floor once animation surpasses it
          if (animTokens > floorTokensRef.current) {
            floorTokensRef.current = animTokens;
          }
        }
        if (linesChanged) {
          const visibleLines = Math.max(animLines, floorLinesRef.current);
          setDisplayedLines(visibleLines);
          if (animLines > floorLinesRef.current) {
            floorLinesRef.current = animLines;
          }
        }

        // Save to localStorage periodically with lag (ensures headroom on next visit)
        if (timestamp - lastSaveTimeRef.current > 10_000) {
          lastSaveTimeRef.current = timestamp;
          const saveTokens = Math.max(0, Math.floor(displayedTokensRef.current) - SAVE_LAG_TOKENS);
          const saveLagLines = Math.round(SAVE_LAG_TOKENS / VISUAL_TOKENS_PER_LINE);
          const saveLines = Math.max(0, Math.floor(displayedLinesRef.current) - saveLagLines);
          const storedT = Number(localStorage.getItem(STORAGE_KEY_TOKENS) || '0');
          const storedL = Number(localStorage.getItem(STORAGE_KEY_LINES) || '0');
          if (saveTokens > storedT) localStorage.setItem(STORAGE_KEY_TOKENS, String(saveTokens));
          if (saveLines > storedL) localStorage.setItem(STORAGE_KEY_LINES, String(saveLines));
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // Poll for updated actuals
  useEffect(() => {
    fetchAndUpdateUsage();
    const interval = setInterval(fetchAndUpdateUsage, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchAndUpdateUsage]);

  // Don't apply mood class until loaded to prevent flash
  const moodClass = isLoading ? '' : `mood-${mood}`;

  return (
    <div className={`min-h-screen relative ${moodClass} scanlines`}>
      {/* Activity log - top left */}
      <div className="activity-log fixed top-3 left-4 z-50 hidden sm:flex">
        {/* Cursor usage stats - above social on narrow, right of social on wide */}
        {(cursorUsage || displayedTokens > 0 || displayedLines > 0) && (
          <div className="cursor-stats">
            <div className="cursor-stat-row">
              <span className="cursor-stat-label">Recent Code</span>
              <span className="cursor-stat-value">{displayedLines.toLocaleString()} lines</span>
            </div>
            <div className="cursor-stat-row">
              <span className="cursor-stat-label">Tokens</span>
              <span className="cursor-stat-value">{displayedTokens.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Social media log */}
        <div className="social-log">
          <span className="social-log-label">social media</span>
          <div className="social-log-inner">
            {socialMediaLog.map((entry, i) => (
              <div
                key={i}
                className="social-log-row"
                style={{ opacity: Math.max(0, 1 - i * 0.09) }}
              >
                <span className="social-log-date">{entry.date}</span>
                <span className="social-log-mins">{entry.minutes} min</span>
              </div>
            ))}
          </div>
        </div>
      </div>

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
          className="github-link linkedin-link flex group"
          title="Connect on LinkedIn"
        >
          <svg className="w-4 h-4 my-0.5 linkedin-icon" viewBox="0 0 24 24">
            <path className="linkedin-path" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
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
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-start sm:justify-center px-2 sm:px-6 pt-20 sm:pt-16 pb-8 sm:pb-12">
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
          
          {/* Flow meter + Load meter */}
          <div className={`mt-6 w-[92vw] sm:w-full sm:max-w-md md:max-w-lg mx-auto transition-opacity duration-500 ${isLoading ? 'opacity-30' : 'opacity-100'}`}>
            {/* Flow meter */}
            <div className="flow-meter-section mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] sm:text-[11px] uppercase tracking-wider font-medium text-blue-300/70">
                  Flow
                </span>
                <span className="text-[10px] sm:text-[11px] font-mono text-blue-300/50 tabular-nums">
                  {flowPercent >= 100 ? '100' : flowPercent.toFixed(4)}%
                </span>
              </div>
              <div className="flow-meter-track">
                <div
                  className="flow-meter-fill"
                  style={{ width: `${Math.min(100, flowPercent)}%` }}
                />
              </div>
            </div>

            {/* Attention meter */}
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

        {/* Flowkeeper widget — visible when authenticated or recently logged in */}
        {(isAuthenticated || hasRecentLogin) && (
        <div className="w-[92vw] sm:w-full sm:max-w-md md:max-w-lg mt-10">
          <div className="flowkeeper">
            {/* Task table */}
            {activeFlowTasks.length === 0 ? (
              <div className="text-center text-white/30 py-4 text-xs">
                No flow tasks
              </div>
            ) : (
              <div className="flowkeeper-table">
                {activeFlowTasks.map(task => (
                  <div key={task.id} className="flowkeeper-row">
                    {/* Complete button (auth only) */}
                    {isAuthenticated && editingFlowId !== task.id && (
                      <button
                        onClick={() => completeFlowTask(task.id)}
                        className="flowkeeper-check"
                        title="Mark complete"
                      >
                        ✓
                      </button>
                    )}

                    {/* Label */}
                    {editingFlowId === task.id && isAuthenticated ? (
                      <input
                        type="text"
                        className="edit-input flex-1 text-sm"
                        value={newFlowLabel}
                        onChange={e => setNewFlowLabel(e.target.value)}
                        onBlur={finishEditingFlow}
                        onKeyDown={e => e.key === 'Enter' && finishEditingFlow()}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`flex-1 text-sm text-white/80 ${isAuthenticated ? 'cursor-text hover:text-white' : ''}`}
                        onClick={() => isAuthenticated && startEditingFlow(task)}
                      >
                        {task.label}
                      </span>
                    )}

                    {/* Difficulty badge */}
                    {isAuthenticated && editingFlowId !== task.id ? (
                      <select
                        value={task.difficulty}
                        onChange={e => updateFlowTask(task.id, { difficulty: Number(e.target.value) as 1 | 2 | 3 })}
                        className="flowkeeper-difficulty-select"
                      >
                        <option value={1}>Easy</option>
                        <option value={2}>Medium</option>
                        <option value={3}>Hard</option>
                      </select>
                    ) : (
                      <span className={`flow-difficulty flow-difficulty-${task.difficulty}`}>
                        {difficultyLabel(task.difficulty)}
                      </span>
                    )}

                    {/* Delete (auth only) */}
                    {isAuthenticated && editingFlowId !== task.id && (
                      <button
                        onClick={() => deleteFlowTask(task.id)}
                        className="text-white/30 hover:text-red-400 transition-colors px-1 text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add flow task (auth only) */}
            {isAuthenticated && (
              <button
                onClick={addFlowTask}
                className="mt-3 w-full py-2 border border-dashed border-blue-400/20 rounded text-blue-300/40 hover:text-blue-300/70 hover:border-blue-400/40 transition-all text-xs"
              >
                + Add Flow Task
              </button>
            )}
          </div>
        </div>
        )}

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
