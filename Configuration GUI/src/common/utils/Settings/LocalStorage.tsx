const saveToLocalStorage = (key: string, value: any) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const deleteLocalStorageEntry = (key: string) => {
  const trafficGenData = JSON.parse(
    localStorage.getItem("traffic_gen") || "{}"
  );
  delete trafficGenData[key];

  // Update keys to ensure no gaps
  const updatedData: any = {};
  let newIndex = 1;
  Object.keys(trafficGenData).forEach((k) => {
    updatedData[newIndex] = trafficGenData[k];
    newIndex++;
  });

  localStorage.setItem("traffic_gen", JSON.stringify(updatedData));
};

export { saveToLocalStorage, deleteLocalStorageEntry };
