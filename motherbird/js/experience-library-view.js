export function experienceLibraryHtml({ balance = 0, experiences = [] } = {}) {
  if (!experiences.length) return '';
  const cards = experiences.map((item) => {
    const unlocked = new Set(item.progress?.unlockedMilestoneIds || []);
    const topics = item.knowledge.topics.map((topic) => `<article><h4>${escapeHtml(topic.title)}</h4><p>${escapeHtml(topic.body)}</p></article>`).join('');
    const milestones = item.milestones.map((milestone, index) => {
      const earned = unlocked.has(milestone.id);
      const priorRequired = index > 0 && !unlocked.has(item.milestones[index - 1].id);
      const stateText = earned ? `Earned · ${escapeHtml(milestone.badge)}` : priorRequired ? `Complete ${escapeHtml(item.milestones[index - 1].title)} first` : `${milestone.stepCost.toLocaleString()} steps`;
      return `<li><span><strong>${escapeHtml(milestone.title)}</strong><small>${stateText}</small></span><button type="button" class="secondary-button" data-experience-unlock="${escapeHtml(item.id)}" data-experience-milestone="${escapeHtml(milestone.id)}" ${earned ? 'disabled' : ''}>${earned ? 'Unlocked' : 'Spend steps'}</button></li>`;
    }).join('');
    return `<details class="guide-card learn-experience"><summary><small>${escapeHtml(item.kind.replaceAll('-', ' '))}</small><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></summary><section aria-label="Knowledge"><p><strong>Learn anytime</strong> · knowledge does not cost steps.</p>${topics}</section><ol class="experience-milestones">${milestones}</ol></details>`;
  }).join('');
  return `<details class="learn-authored learn-experience-library" open><summary class="learn-section-summary">Experiences <span>${experiences.length}</span></summary><p><strong>${Number(balance).toLocaleString()} steps available.</strong> Spend measured walking steps on milestones; reading remains open.</p><div class="learn-authored-grid">${cards}</div></details>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

