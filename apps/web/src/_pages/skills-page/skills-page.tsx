import { createServerApiClient } from '@web/shared/auth/api-auth';
import { SkillsGrid } from './skills-grid';

async function loadSkills() {
  try {
    return await createServerApiClient().fetchSkills();
  } catch {
    return [];
  }
}

export default async function SkillsPage() {
  const skills = await loadSkills();

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--foreground)' }}>
          Analysis Skills
        </h1>
        <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 15 }}>
          Chọn một skill để bắt đầu phân tích với AI chuyên biệt.
        </p>
      </div>
      <SkillsGrid skills={skills} />
    </div>
  );
}
