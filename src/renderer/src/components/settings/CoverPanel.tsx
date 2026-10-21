import { Info, TriangleAlert } from 'lucide-react';
import { COVER_NAME_OPTIONS } from '@shared/defaults';
import { useAppStore } from '../../store/useAppStore';
import { SettingRow, SettingsCard, Switch } from '../ui';

const COVER_LABELS: Record<string, string> = {
  cover: 'cover.jpg（推荐）',
  folder: 'folder.jpg',
  front: 'front.jpg',
  album: 'album.jpg',
  封面: '封面.jpg'
};

export default function CoverPanel(): JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const cover = settings.cover;

  return (
    <div className="panel-stack">
      <SettingsCard
        title="封面整理"
        description="为每个作品文件夹选择一张图片作为封面。手动选择的封面优先于自动选择。"
      >
        <SettingRow
          title="自动选择封面"
          description="批量整理时，自动选用 cover / folder / front 等明确命名的图片；如果文件夹里只有一张图片，也会自动选中。候选图片很多且命名不明确时不猜。"
          control={
            <Switch
              checked={cover.autoPick}
              onChange={(autoPick) => updateSettings({ cover: { autoPick } })}
              label="自动选择封面"
            />
          }
        />
        <SettingRow
          title="封面文件名"
          description="不同播放器识别的封面名不同；cover 的兼容性最好。"
          control={
            <div className="select-wrap">
              <select
                className="select"
                value={cover.name}
                onChange={(event) => updateSettings({ cover: { name: event.target.value } })}
                aria-label="封面文件名"
              >
                {COVER_NAME_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {COVER_LABELS[name] || name + '.jpg'}
                  </option>
                ))}
              </select>
            </div>
          }
        />
        <SettingRow
          title="统一转为 JPG"
          description="JPG 兼容性最好。转换会保留原图，不会删除。"
          control={
            <Switch
              checked={cover.convertToJpeg}
              onChange={(convertToJpeg) => updateSettings({ cover: { convertToJpeg } })}
              label="统一转为 JPG"
            />
          }
        />
        <SettingRow
          title="覆盖已有封面"
          description="关闭时，目标封面已存在会跳过并提示；开启时会先备份旧封面，仍可撤销。"
          control={
            <Switch
              checked={cover.overwrite}
              onChange={(overwrite) => updateSettings({ cover: { overwrite } })}
              label="覆盖已有封面"
            />
          }
        />
        {cover.overwrite ? (
          <div className="callout callout-warn">
            <TriangleAlert size={14} />
            已有封面会先备份到应用数据目录，执行记录中可撤销。
          </div>
        ) : null}
        <div className="callout callout-accent">
          <Info size={14} />
          自动封面只作用于有音频的文件夹；没有合适候选时会跳过并提示，不会强行挑一张场景图。
        </div>
      </SettingsCard>
    </div>
  );
}
