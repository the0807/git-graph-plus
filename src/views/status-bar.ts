import * as vscode from 'vscode';

export class StatusBarManager implements vscode.Disposable {
  private statusItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1
    );
    this.statusItem.text = '$(git-merge)';
    this.statusItem.command = 'gitGraphPlus.open';
    this.statusItem.tooltip = 'Git Graph+ — ' + vscode.l10n.t('clickToOpen');
    this.disposables.push(this.statusItem);

    this.statusItem.show();
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
