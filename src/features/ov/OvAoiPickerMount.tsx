import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useUiStore } from '../../store/ui';
import { OvAoiPicker } from './OvAoiPicker';

/**
 * 仅当 pickerMode === 'ov-aoi-pick' 时挂载 OvAoiPicker 实例。
 * 取消时（pickerMode 切换）销毁。Esc / 完成由 picker 自身或 HUD 触发。
 */
export function OvAoiPickerMount() {
  const viewer = useCesiumViewer();
  const pickerMode = useUiStore((s) => s.pickerMode);
  const pickerRef = useRef<OvAoiPicker | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    if (pickerMode !== 'ov-aoi-pick') {
      // 退出 picker 销毁
      if (pickerRef.current) {
        pickerRef.current.destroy();
        pickerRef.current = null;
      }
      return;
    }
    // 进入 picker
    pickerRef.current = new OvAoiPicker(viewer);
    return () => {
      if (pickerRef.current) {
        pickerRef.current.destroy();
        pickerRef.current = null;
      }
    };
  }, [viewer, pickerMode]);

  return null;
}
