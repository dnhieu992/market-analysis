'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { Skill } from '@web/shared/api/types';

const CATEGORY_LABELS: Record<string, string> = {
  analysis: 'Analysis',
  strategy: 'Strategy',
  education: 'Education'
};

const CATEGORY_COLORS: Record<string, string> = {
  analysis: '#1f6f5b',
  strategy: '#2d5f8a',
  education: '#7c5a2a'
};

const api = createApiClient();

function SkillCard({ skill }: { skill: Skill }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUseSkill() {
    setLoading(true);
    try {
      const conversation = await api.createConversation(skill.name, skill.id);
      router.push(`/skills/${skill.id}/chat/${conversation.id}`);
    } catch (err) {
      console.error('Failed to create conversation', err);
      setLoading(false);
    }
  }

  const categoryColor = CATEGORY_COLORS[skill.category] ?? 'var(--accent)';

  return (
    <div className="skill-card">
      <div className="skill-card-top">
        <span className="skill-card-icon">{skill.icon}</span>
        <div className="skill-card-meta">
          <h3 className="skill-card-name">{skill.name}</h3>
          <span
            className="skill-card-badge"
            style={{ color: categoryColor, background: `${categoryColor}18` }}
          >
            {CATEGORY_LABELS[skill.category] ?? skill.category}
          </span>
        </div>
      </div>

      <p className="skill-card-desc">{skill.description}</p>

      {skill.exampleQuestions.length > 0 && (
        <div className="skill-card-examples">
          {skill.exampleQuestions.slice(0, 2).map((q) => (
            <p key={q} className="skill-card-example">{q}</p>
          ))}
        </div>
      )}

      <button
        className="skill-card-btn"
        onClick={() => { void handleUseSkill(); }}
        disabled={loading}
      >
        {loading ? 'Đang tạo...' : 'Dùng skill này'}
      </button>
    </div>
  );
}

export function SkillsGrid({ skills }: { skills: Skill[] }) {
  if (skills.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 15 }}>
        Không thể tải danh sách skills. Vui lòng thử lại.
      </p>
    );
  }

  return (
    <div className="skills-grid">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} />
      ))}
    </div>
  );
}
