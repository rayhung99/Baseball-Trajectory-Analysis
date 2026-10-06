import { useRef, useCallback, useEffect } from 'react';
import {
  analyzeVideoOffline,
  addProgressListener,
  type ABSCalibration,
  type AnalysisOptions,
} from '../../modules/expo-speedgun';
import { toPitchResult } from '../adapters/nativeAnalysis';
import { PitchResult, StrikeZoneCalibration } from '../types';
import { normalizePipelineProgress, type PipelineProgressState } from '../utils/pipelineStages';
import { UserCancelledError } from '../utils/errors';

// ponytail: one native slot because progress has no job ID; add per-job events
// before allowing parallel analyses.
let analysisInProgress = false;

interface OfflineAnalysisCallbacks {
  onProgress?: (progress: PipelineProgressState) => void;
}

export function useOfflineAnalysis() {
  const abortRef = useRef(false);
  const mountedRef = useRef(true);
  const subscriptionRef = useRef<{ remove(): void } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, []);

  const analyze = useCallback(
    async (
      videoUri: string,
      opts: {
        moundDistanceM?: number;
        strideCorrectionM?: number;
        confThreshold?: number;
        pitcherHeightM?: number;
        batterHeightM?: number;
        strikeZone?: StrikeZoneCalibration | null;
        absCalibration?: ABSCalibration | null;
        absCalibrationJson?: string | null;
      },
      callbacks?: OfflineAnalysisCallbacks,
    ): Promise<PitchResult> => {
      if (!mountedRef.current) throw new UserCancelledError();
      if (analysisInProgress) throw new Error('已有分析正在進行，請等待完成後再試。');
      analysisInProgress = true;
      abortRef.current = false;

      try {
        subscriptionRef.current = addProgressListener((event) => {
          if (abortRef.current) return;
          callbacks?.onProgress?.(normalizePipelineProgress(event));
        });
        const nativeOptions: AnalysisOptions = {
          moundDistance: opts.moundDistanceM,
          strideCorrectionM: opts.strideCorrectionM,
          confThreshold: opts.confThreshold,
          pitcherHeightM: opts.pitcherHeightM,
          batterHeightM: opts.batterHeightM,
          strikeZone: opts.strikeZone,
        };
        if (opts.absCalibration != null) {
          nativeOptions.absCalibration = opts.absCalibration;
        }
        if (opts.absCalibrationJson != null && opts.absCalibrationJson.trim() !== '') {
          nativeOptions.absCalibrationJson = opts.absCalibrationJson;
        }

        const raw = await analyzeVideoOffline(videoUri, nativeOptions);
        if (abortRef.current) throw new UserCancelledError();
        return toPitchResult(raw);
      } finally {
        analysisInProgress = false;
        subscriptionRef.current?.remove();
        subscriptionRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    // Stop delivery; the native work keeps its slot until it actually finishes.
    abortRef.current = true;
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
  }, []);

  return { analyze, cancel };
}
