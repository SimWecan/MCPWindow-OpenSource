document.getElementById('apply').addEventListener('click', () => window.closeDialog.choose('apply'))
document.getElementById('cancel').addEventListener('click', () => window.closeDialog.choose('cancel'))
document.getElementById('dismiss').addEventListener('click', () => window.closeDialog.choose('cancel'))
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.closeDialog.choose('cancel')
  if (event.key === 'Enter') window.closeDialog.choose('apply')
})
