import { usePlayPageContext } from './PlayPageContext';
import AddPagesFromPromptModal from '../../components/AddPagesFromPromptModal';
import { TtsDialog } from './TtsDialog';
import { ImageStyleDialog } from './ImageStyleDialog';
import { RegenAllDialog } from './RegenAllDialog';
import { ShareDialog } from './ShareDialog';

export function PlayPageDialogs() {
  const {
    isReadOnlyProcessing,
    // TTS
    ttsDialogOpen, setTtsDialogOpen, ttsProvider, availableTtsVoices,
    ttsVoice, setTtsVoice, hostMode, setHostMode, ttsSpeed, setTtsSpeed,
    scriptMaxCharsPerPage, setScriptMaxCharsPerPage, ttsMsg, ttsBusy,
    handleSaveTtsSettings,
    // ImageStyle
    imageStyleDialogOpen, setImageStyleDialogOpen, imageStyleTemplates,
    selectedImageStyleTemplateKey, setSelectedImageStyleTemplateKey,
    applyImageStyleTemplate, deckImageStylePrompt, setDeckImageStylePrompt,
    handleSaveImageStyle,
    // RegenAll
    regenAllDialogOpen, setRegenAllDialogOpen, deckPages,
    regenSelectedPages, regenOptions, setRegenOptions,
    regenAllPrompt, setRegenAllPrompt, regenScriptPrompt, setRegenScriptPrompt,
    regenScriptMaxCharsPerPage, setRegenScriptMaxCharsPerPage,
    regenJob, setRegenJob, regenAllMsg, setRegenAllMsg,
    regenAllBusy, regenJobRunning, regenAnySelected,
    handleConfirmRegenerate,
    // Share
    shareDialogOpen, setShareDialogOpen, shareUrl, setShareMessage, setShareError,
    // AddPages
    showAddPagesModal, setShowAddPagesModal, pdfId, currentPage, totalPages,
    reloadDetail, setCurrentIdx,
  } = usePlayPageContext();

  return (
    <>
      {ttsDialogOpen ? (
        <TtsDialog
          ttsProvider={ttsProvider}
          availableTtsVoices={availableTtsVoices}
          ttsVoice={ttsVoice}
          onTtsVoiceChange={setTtsVoice}
          hostMode={hostMode}
          onHostModeChange={setHostMode}
          ttsSpeed={ttsSpeed}
          onTtsSpeedChange={setTtsSpeed}
          scriptMaxCharsPerPage={scriptMaxCharsPerPage}
          onScriptMaxCharsPerPageChange={setScriptMaxCharsPerPage}
          ttsMsg={ttsMsg}
          ttsBusy={ttsBusy}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => setTtsDialogOpen(false)}
          onSave={() => void handleSaveTtsSettings()}
        />
      ) : null}

      {imageStyleDialogOpen ? (
        <ImageStyleDialog
          imageStyleTemplates={imageStyleTemplates}
          selectedImageStyleTemplateKey={selectedImageStyleTemplateKey}
          onSelectedImageStyleTemplateKeyChange={setSelectedImageStyleTemplateKey}
          onApplyTemplate={applyImageStyleTemplate}
          deckImageStylePrompt={deckImageStylePrompt}
          onDeckImageStylePromptChange={setDeckImageStylePrompt}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => setImageStyleDialogOpen(false)}
          onSave={handleSaveImageStyle}
        />
      ) : null}

      {regenAllDialogOpen ? (
        <RegenAllDialog
          deckPagesCount={deckPages.length}
          regenSelectedPages={regenSelectedPages}
          regenOptions={regenOptions}
          onRegenOptionsChange={setRegenOptions}
          regenAllPrompt={regenAllPrompt}
          onRegenAllPromptChange={setRegenAllPrompt}
          regenScriptPrompt={regenScriptPrompt}
          onRegenScriptPromptChange={setRegenScriptPrompt}
          regenScriptMaxCharsPerPage={regenScriptMaxCharsPerPage}
          onRegenScriptMaxCharsPerPageChange={setRegenScriptMaxCharsPerPage}
          regenJob={regenJob}
          regenAllMsg={regenAllMsg}
          regenAllBusy={regenAllBusy}
          regenJobRunning={regenJobRunning}
          regenAnySelected={regenAnySelected}
          isReadOnlyProcessing={isReadOnlyProcessing}
          onClose={() => {
            setRegenAllDialogOpen(false);
            if (!regenJobRunning) {
              setRegenJob(null);
              setRegenAllMsg(null);
            }
          }}
          onConfirm={() => void handleConfirmRegenerate()}
        />
      ) : null}

      {shareDialogOpen ? (
        <ShareDialog
          shareUrl={shareUrl}
          onCopySuccess={() => {
            setShareMessage('已複製分享連結');
            setShareError(null);
          }}
          onCopyError={() => setShareError('瀏覽器不允許自動複製，請手動複製。')}
          onClose={() => setShareDialogOpen(false)}
        />
      ) : null}

      {showAddPagesModal && pdfId ? (
        <AddPagesFromPromptModal
          pdfId={pdfId}
          insertAfterPage={currentPage?.page_number ?? totalPages}
          onClose={() => setShowAddPagesModal(false)}
          onDone={async (totalPagesAfter) => {
            setShowAddPagesModal(false);
            await reloadDetail();
            setCurrentIdx(totalPagesAfter - 1);
          }}
        />
      ) : null}
    </>
  );
}
