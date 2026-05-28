import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useUiStore } from '../../store/ui';
import { useOvPickerStore } from '../../store/ov-picker';
import { OvAuxPicker } from './OvAuxPickers';

/**
 * 障碍物 / 禁飞区 picker 挂载点。pickerMode === 'ov-obstacle-pick' / 'ov-nofly-pick' 时挂载。
 * 累加点写入 ov-picker store.auxPreview 给 OvLayer 画临时预览。
 */
export function OvAuxPickerMount() {
  const viewer = useCesiumViewer();
  const pickerMode = useUiStore((s) => s.pickerMode);
  const setAuxPreview = useOvPickerStore((s) => s.setAuxPreview);
  const pickerRef = useRef<OvAuxPicker | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const kind =
      pickerMode === 'ov-obstacle-pick'
        ? 'obstacle'
        : pickerMode === 'ov-nofly-pick'
          ? 'nofly'
          : null;
    if (!kind) {
      if (pickerRef.current) {
        pickerRef.current.destroy();
        pickerRef.current = null;
        setAuxPreview([]);
      }
      return;
    }
    pickerRef.current = new OvAuxPicker(viewer, kind, (pts) => setAuxPreview(pts));
    return () => {
      if (pickerRef.current) {
        pickerRef.current.destroy();
        pickerRef.current = null;
      }
      setAuxPreview([]);
    };
  }, [viewer, pickerMode, setAuxPreview]);

  return null;
}
