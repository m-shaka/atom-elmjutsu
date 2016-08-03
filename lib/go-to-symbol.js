'use babel';

import path from 'path';
const _ = require('underscore-plus');
import helper from './helper';
import GoToSymbolView from './go-to-symbol-view';

export default class GoToSymbol {

  constructor(indexer) {
    this.stateBeforeFind = null;
    this.view = new GoToSymbolView();
    indexer.ports.goToSymbolCmd.subscribe(([defaultSymbolName, activeFile, symbols]) => {
      this.show(defaultSymbolName, (activeFile && activeFile.filePath) || null, symbols);
    });
    var previewDebouncer = null;
    this.view.onDidSelect(({symbol}) => {
      if (previewDebouncer) {
        clearTimeout(previewDebouncer);
      }
      previewDebouncer =
        setTimeout(() => {
          this.view.cancelling = true;
          this.viewElmFile(symbol, true).then(() => {
            this.view.cancelling = false;
            this.view.focusFilterEditor();
          });
        }, 30);
    });
    this.view.onDidConfirm(({symbol}) => {
      this.viewElmFile(symbol, false);
      this.destroyUsageMarker();
      this.reenableLinterPackage();
    });
    this.view.onDidCancel(() => {
      this.revertToStateBeforeFind();
      this.reenableLinterPackage();
    });
  }

  destroy() {
    this.stateBeforeFind = null;
    this.view.destroy();
  }

  reenableLinterPackage() {
    if (this.linterPackageDisabled) {
      atom.packages.enablePackage('linter');
      this.linterPackageDisabled = false;
    }
  }

  storeStateBeforeFind(editor) {
    const editorView = atom.views.getView(editor);
    this.stateBeforeFind = {
      existingEditorIds: new Set(atom.workspace.getTextEditors().map(({id}) => id)),
      pane: atom.workspace.getActivePane(),
      editor: editor,
      cursorPosition: editor.getCursorBufferPosition(),
      scrollTop: editorView.getScrollTop(),
      scrollLeft: editorView.getScrollLeft()
    };
  }

  revertToStateBeforeFind() {
    const pane = this.stateBeforeFind.pane;
    const editor = this.stateBeforeFind.editor;
    pane.activateItem(editor);
    const editorView = atom.views.getView(editor);
    editor.setCursorBufferPosition(this.stateBeforeFind.cursorPosition);
    editorView.setScrollTop(this.stateBeforeFind.scrollTop);
    editorView.setScrollLeft(this.stateBeforeFind.scrollLeft);
    this.closeTemporaryEditors();
    this.destroyUsageMarker();
  }

  closeTemporaryEditors(exceptEditorId) {
    atom.workspace.getTextEditors().forEach((textEditor) => {
      if ((!exceptEditorId || (exceptEditorId && textEditor.id !== exceptEditorId)) && !this.stateBeforeFind.existingEditorIds.has(textEditor.id)) {
        textEditor.destroy();
      }
    });
  }

  viewElmFile(symbol, isPreview) {
    // Open file containing symbol.
    return atom.workspace.open(symbol.sourcePath, {pending: isPreview}).then((editor) => {
      const nameParts = symbol.fullName.split('.');
      const lastName = nameParts[nameParts.length - 1];
      // Move the cursor to the symbol definition's position.
      var symbolRange = editor.getSelectedBufferRange();
      helper.scanForSymbolDefinitionRange(editor, lastName, symbol.caseTipe, (range) => {
        symbolRange = range;
        editor.setCursorBufferPosition(symbolRange.start);
        editor.scrollToCursorPosition({center: true});
      });
      if (isPreview) {
        this.destroyUsageMarker();
        this.symbolMarker = editor.markBufferRange(symbolRange, {invalidate: 'never', persistent: false});
        editor.decorateMarker(this.symbolMarker, {type: 'highlight', class: 'elmjutsu-symbol-highlight'});
      }
      if (!isPreview) {
        this.closeTemporaryEditors(editor.id);
      }
    });
  }

  destroyUsageMarker() {
    if (this.symbolMarker) {
      this.symbolMarker.destroy();
      this.symbolMarker = null;
    }
  }

  show(defaultSymbolFullName, activeFilePath, symbols) {
    // Temporarily disable `linter` package.
    this.linterPackageDisabled = atom.packages.disablePackage('linter');
    const editor = atom.workspace.getActiveTextEditor();
    this.storeStateBeforeFind(editor);
    this.view.show();
    const cancel = () => {
      this.view.hide();
    };
    const editorFilePath = editor.getPath();
    if (!editorFilePath) {
      return cancel();
    }
    this.view.setSymbols(defaultSymbolFullName, activeFilePath, symbols);
  }

}