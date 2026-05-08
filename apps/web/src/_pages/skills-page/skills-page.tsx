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
    <div className="skills-page">
      <div className="skills-page-header">
        <h1>Analysis Skills</h1>
        <p>Chọn một skill để bắt đầu phân tích với AI chuyên biệt.</p>
      </div>
      <SkillsGrid skills={skills} />
    </div>
  );
}
