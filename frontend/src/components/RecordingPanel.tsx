import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useEEGStore } from '../store/eeg';
import { Recording } from '../types';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (ms: number): string => {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

type DurationFilter = 'all' | '<1' | '1-5' | '5-15' | '>15';
type StatusFilter = 'all' | 'focused' | 'relaxed' | 'fatigued' | 'neutral';
type DateFilter = 'all' | 'today' | '7days' | '30days';
type SortBy = 'date_desc' | 'date_asc' | 'duration_desc' | 'duration_asc' | 'name_asc';

const DURATION_OPTIONS: { value: DurationFilter; label: string }[] = [
  { value: 'all', label: '全部时长' },
  { value: '<1', label: '< 1分钟' },
  { value: '1-5', label: '1-5分钟' },
  { value: '5-15', label: '5-15分钟' },
  { value: '>15', label: '> 15分钟' },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'focused', label: '专注' },
  { value: 'relaxed', label: '放松' },
  { value: 'fatigued', label: '疲劳' },
  { value: 'neutral', label: '中性' },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: '全部日期' },
  { value: 'today', label: '今天' },
  { value: '7days', label: '近7天' },
  { value: '30days', label: '近30天' },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'date_desc', label: '日期 ↓' },
  { value: 'date_asc', label: '日期 ↑' },
  { value: 'duration_desc', label: '时长 ↓' },
  { value: 'duration_asc', label: '时长 ↑' },
  { value: 'name_asc', label: '名称 A-Z' },
];

const STATUS_LABELS: Record<string, string> = {
  focused: '专注',
  relaxed: '放松',
  fatigued: '疲劳',
  neutral: '中性',
};

const STATUS_COLORS: Record<string, string> = {
  focused: '#1976d2',
  relaxed: '#388e3c',
  fatigued: '#d32f2f',
  neutral: '#757575',
};

const filterSelectStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  fontSize: '11px',
  color: '#333',
  background: '#fff',
  cursor: 'pointer',
  outline: 'none',
};

const getPredominantStatus = (recording: Recording): string => {
  if (recording.frames.length === 0) return 'neutral';
  const counts: Record<string, number> = {};
  for (const frame of recording.frames) {
    const s = frame.brainState.status;
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

const matchDurationFilter = (duration: number, filter: DurationFilter): boolean => {
  const mins = duration / 60;
  switch (filter) {
    case 'all': return true;
    case '<1': return mins < 1;
    case '1-5': return mins >= 1 && mins < 5;
    case '5-15': return mins >= 5 && mins < 15;
    case '>15': return mins >= 15;
  }
};

const matchDateFilter = (startTime: number, filter: DateFilter): boolean => {
  if (filter === 'all') return true;
  const now = Date.now();
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  switch (filter) {
    case 'today': return startTime >= startOfDay;
    case '7days': return startTime >= now - 7 * 24 * 3600 * 1000;
    case '30days': return startTime >= now - 30 * 24 * 3600 * 1000;
  }
};

const sortRecordings = (recs: Recording[], sortBy: SortBy): Recording[] => {
  const sorted = [...recs];
  switch (sortBy) {
    case 'date_desc': return sorted.sort((a, b) => b.startTime - a.startTime);
    case 'date_asc': return sorted.sort((a, b) => a.startTime - b.startTime);
    case 'duration_desc': return sorted.sort((a, b) => b.duration - a.duration);
    case 'duration_asc': return sorted.sort((a, b) => a.duration - b.duration);
    case 'name_asc': return sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
};

export const RecordingPanel: React.FC = () => {
  const {
    isRecording,
    currentRecordingFrames,
    recordings,
    playbackMode,
    activeRecording,
    playbackState,
    startRecording,
    stopRecording,
    deleteRecording,
    enterPlaybackMode,
    exitPlaybackMode,
    setPlaybackTime,
    togglePlayback,
    setPlaybackPlaying,
    selectedChannel,
  } = useEEGStore();

  const [recordingName, setRecordingName] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [filterDuration, setFilterDuration] = useState<DurationFilter>('all');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterDate, setFilterDate] = useState<DateFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date_desc');
  const timerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);

  const filteredRecordings = useMemo(() => {
    let result = recordings.filter((r: Recording) => {
      if (!matchDurationFilter(r.duration, filterDuration)) return false;
      if (filterStatus !== 'all' && getPredominantStatus(r) !== filterStatus) return false;
      if (!matchDateFilter(r.startTime, filterDate)) return false;
      return true;
    });
    return sortRecordings(result, sortBy);
  }, [recordings, filterDuration, filterStatus, filterDate, sortBy]);

  const hasActiveFilter = filterDuration !== 'all' || filterStatus !== 'all' || filterDate !== 'all';

  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setElapsedTime(currentRecordingFrames.length * 3);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, currentRecordingFrames.length]);

  useEffect(() => {
    if (playbackState.isPlaying && activeRecording) {
      playbackTimerRef.current = window.setInterval(() => {
        const { playbackState, activeRecording, setPlaybackTime, setPlaybackPlaying } = useEEGStore.getState();
        if (!activeRecording) return;
        const newTime = playbackState.currentTime + 0.1;
        if (newTime >= activeRecording.duration) {
          setPlaybackTime(activeRecording.duration);
          setPlaybackPlaying(false);
        } else {
          setPlaybackTime(newTime);
        }
      }, 100);
    } else {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    }
    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [playbackState.isPlaying, activeRecording]);

  const handleStartRecording = () => {
    startRecording();
  };

  const handleStopRecording = () => {
    setShowNameDialog(true);
  };

  const handleConfirmSave = () => {
    stopRecording(recordingName.trim());
    setRecordingName('');
    setShowNameDialog(false);
  };

  const handleCancelSave = () => {
    useEEGStore.setState({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
    });
    setShowNameDialog(false);
    setRecordingName('');
  };

  const handlePlayRecording = (recording: Recording) => {
    enterPlaybackMode(recording);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setPlaybackTime(time);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = percentage * activeRecording.duration;
    setPlaybackTime(time);
  };

  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>⏺</span>
        录制与回放
      </h3>

      {!playbackMode && (
        <div style={{ marginBottom: '16px' }}>
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #d32f2f, #b71c1c)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span style={{ fontSize: '16px' }}>⏺</span>
              开始录制 ({CHANNEL_NAMES[selectedChannel] || selectedChannel})
            </button>
          ) : (
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                background: '#ffebee',
                borderRadius: '8px',
                marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#d32f2f',
                    animation: 'pulse 1s infinite',
                  }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#d32f2f' }}>录制中</span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                  {formatDuration(elapsedTime)} · {currentRecordingFrames.length} 帧
                </span>
              </div>
              <button
                onClick={handleStopRecording}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#757575',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⏹ 停止录制
              </button>
            </div>
          )}
        </div>
      )}

      {playbackMode && activeRecording && (
        <div style={{
          marginBottom: '16px',
          padding: '14px',
          background: 'linear-gradient(135deg, #e3f2fd, #bbdefb)',
          borderRadius: '10px',
          border: '1px solid #90caf9',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>
                {activeRecording.name}
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                {CHANNEL_NAMES[activeRecording.channel] || activeRecording.channel} · {formatDuration(activeRecording.duration)}
              </div>
            </div>
            <button
              onClick={exitPlaybackMode}
              style={{
                padding: '6px 12px',
                background: '#fff',
                color: '#1565c0',
                border: '1px solid #90caf9',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              退出回放
            </button>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '10px',
          }}>
            <button
              onClick={togglePlayback}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: '#1565c0',
                color: '#fff',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {playbackState.isPlaying ? '⏸' : '▶'}
            </button>

            <div style={{ flex: 1 }}>
              <div
                onClick={handleProgressClick}
                style={{
                  height: '8px',
                  background: '#90caf9',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: '#1565c0',
                    width: `${(playbackState.currentTime / activeRecording.duration) * 100}%`,
                    borderRadius: '4px',
                    transition: 'width 0.1s linear',
                  }}
                />
              </div>
              <input
                type="range"
                min="0"
                max={activeRecording.duration}
                step="0.1"
                value={playbackState.currentTime}
                onChange={handleSeek}
                style={{
                  width: '100%',
                  marginTop: '4px',
                  opacity: 0,
                  position: 'absolute',
                  pointerEvents: 'none',
                }}
              />
            </div>

            <span style={{ fontSize: '12px', color: '#666', minWidth: '70px', textAlign: 'right' }}>
              {formatDuration(playbackState.currentTime)} / {formatDuration(activeRecording.duration)}
            </span>
          </div>

          {playbackState.currentFrame && (
            <div style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              padding: '8px',
              background: 'rgba(255,255,255,0.5)',
              borderRadius: '6px',
            }}>
              <span style={{ fontSize: '11px', color: '#1976d2' }}>专注: {playbackState.currentFrame.brainState.focus.toFixed(0)}</span>
              <span style={{ fontSize: '11px', color: '#388e3c' }}>放松: {playbackState.currentFrame.brainState.relaxation.toFixed(0)}</span>
              <span style={{ fontSize: '11px', color: '#d32f2f' }}>疲劳: {playbackState.currentFrame.brainState.fatigue.toFixed(0)}</span>
              <span style={{ fontSize: '11px', color: '#666' }}>|</span>
              <span style={{ fontSize: '11px', color: '#1565c0' }}>α: {playbackState.currentFrame.bands.alpha.toFixed(2)}</span>
              <span style={{ fontSize: '11px', color: '#e53935' }}>β: {playbackState.currentFrame.bands.beta.toFixed(2)}</span>
              <span style={{ fontSize: '11px', color: '#2e7d32' }}>θ: {playbackState.currentFrame.bands.theta.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <div>
        <div style={{
          fontSize: '12px',
          color: '#666',
          marginBottom: '8px',
          fontWeight: 500,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>历史录制 ({recordings.length}){hasActiveFilter && ` · 筛选结果 ${filteredRecordings.length}`}</span>
          {hasActiveFilter && (
            <button
              onClick={() => { setFilterDuration('all'); setFilterStatus('all'); setFilterDate('all'); }}
              style={{
                padding: '2px 8px',
                background: '#fff3e0',
                color: '#e65100',
                border: '1px solid #ffb74d',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              清除筛选
            </button>
          )}
        </div>

        {recordings.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginBottom: '10px',
            padding: '10px',
            background: '#fafafa',
            borderRadius: '8px',
            border: '1px solid #eee',
          }}>
            <select
              value={filterDuration}
              onChange={e => setFilterDuration(e.target.value as DurationFilter)}
              style={filterSelectStyle}
            >
              {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as StatusFilter)}
              style={filterSelectStyle}
            >
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={filterDate}
              onChange={e => setFilterDate(e.target.value as DateFilter)}
              style={filterSelectStyle}
            >
              {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortBy)}
              style={filterSelectStyle}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {recordings.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px',
            border: '1px dashed #e0e0e0',
            borderRadius: '8px',
          }}>
            暂无录制记录
          </div>
        ) : filteredRecordings.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px',
            border: '1px dashed #e0e0e0',
            borderRadius: '8px',
          }}>
            无匹配的录制记录
          </div>
        ) : (
          <div style={{ maxHeight: '280px', overflow: 'auto' }}>
            {filteredRecordings.map((recording) => {
              const predominantStatus = getPredominantStatus(recording);
              return (
                <div
                  key={recording.id}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: activeRecording?.id === recording.id
                      ? '2px solid #1565c0'
                      : '1px solid #e0e0e0',
                    marginBottom: '8px',
                    background: activeRecording?.id === recording.id ? '#e3f2fd' : '#fff',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '6px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#333',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{recording.name}</span>
                        <span style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          background: STATUS_COLORS[predominantStatus] + '18',
                          color: STATUS_COLORS[predominantStatus],
                          fontWeight: 500,
                          flexShrink: 0,
                        }}>
                          {STATUS_LABELS[predominantStatus]}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                        {formatTime(recording.startTime)} · {CHANNEL_NAMES[recording.channel] || recording.channel}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button
                        onClick={() => handlePlayRecording(recording)}
                        style={{
                          padding: '4px 10px',
                          background: activeRecording?.id === recording.id ? '#1565c0' : '#f5f5f5',
                          color: activeRecording?.id === recording.id ? '#fff' : '#1565c0',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        {activeRecording?.id === recording.id ? '回放中' : '▶ 回放'}
                      </button>
                      <button
                        onClick={() => deleteRecording(recording.id)}
                        style={{
                          padding: '4px 8px',
                          background: '#ffebee',
                          color: '#d32f2f',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: '11px', color: '#666' }}>
                      时长: {formatDuration(recording.duration)} · {recording.frames.length} 帧
                    </span>
                    <span style={{ fontSize: '11px', color: '#999' }}>
                      {recording.channel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNameDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff',
            padding: '24px',
            borderRadius: '12px',
            width: '320px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <h4 style={{ margin: '0 0 16px', fontSize: '16px', color: '#333' }}>
              保存录制
            </h4>
            <input
              type="text"
              value={recordingName}
              onChange={(e) => setRecordingName(e.target.value)}
              placeholder="输入录制名称（可选）"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmSave();
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelSave}
                style={{
                  padding: '8px 16px',
                  background: '#f5f5f5',
                  color: '#666',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmSave}
                style={{
                  padding: '8px 16px',
                  background: '#1565c0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};
