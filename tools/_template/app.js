document.getElementById('run').addEventListener('click', () => {
  const value = document.getElementById('input').value;
  document.getElementById('output').textContent = value === '' ? '入力してください' : `入力: ${value}`;
});
