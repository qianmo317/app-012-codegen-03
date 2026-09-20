import { ApothecaryGame } from './game';
import { loadSave, saveSave } from './storage';
import { ConversionPanel } from './conversionPanel';

const game = new ApothecaryGame('game-canvas');
game.start();

const panelRoot = document.getElementById('conversion-panel');
const toggleBtn = document.getElementById('conversion-toggle');
if (panelRoot && toggleBtn) {
  const panel = new ConversionPanel(panelRoot);
  toggleBtn.addEventListener('click', () => panel.toggle());
}

window.addEventListener('beforeunload', () => {
  const save = loadSave();
  const currentScore = (game.game?.state?.score) ?? 0;
  const currentLevel = (game.game?.state?.level) ?? 0;
  saveSave({
    highestScore: Math.max(save.highestScore, currentScore),
    highestLevel: Math.max(save.highestLevel, currentLevel),
    lastPlayed: Date.now(),
  });
});
