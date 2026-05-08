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
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      transition: 'box-shadow 0.2s, transform 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 36, lineHeight: 1 }}>{skill.icon}</span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: categoryColor,
          background: `${categoryColor}18`,
          padding: '3px 10px',
          borderRadius: 20,
          whiteSpace: 'nowrap'
        }}>
          {CATEGORY_LABELS[skill.category] ?? skill.category}
        </span>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--foreground)' }}>
          {skill.name}
        </h3>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
          {skill.description}
        </p>
      </div>

      {skill.exampleQuestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {skill.exampleQuestions.slice(0, 2).map((q) => (
            <p key={q} style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--muted)',
              background: 'var(--background)',
              padding: '5px 10px',
              borderRadius: 8,
              lineHeight: 1.4
            }}>
              {q}
            </p>
          ))}
        </div>
      )}

      <button
        onClick={() => { void handleUseSkill(); }}
        disabled={loading}
        style={{
          marginTop: 'auto',
          padding: '10px 20px',
          background: loading ? 'var(--muted)' : 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s'
        }}
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
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: 20
    }}>
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} />
      ))}
    </div>
  );
}
