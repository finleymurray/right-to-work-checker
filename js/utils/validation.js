export function validateRecord(data) {
  const errors = [];
  if (!data.person_name || !data.person_name.trim()) errors.push('Name of person is required.');
  if (!data.date_of_birth) errors.push('Date of birth is required.');
  if (!data.check_date) errors.push('Date of check is required.');
  if (!data.check_type) errors.push('Type of check must be selected.');
  if (!data.checker_name || !data.checker_name.trim()) errors.push('Name of person conducting the check is required.');
  if (!data.declaration_confirmed) errors.push('You must agree to the declaration.');
  if (data.check_method === 'online' && (!data.share_code || !data.share_code.trim())) {
    errors.push('Share code is required for an online check.');
  }
  if (data.check_method === 'idsp' && (!data.idsp_provider || !data.idsp_provider.trim())) {
    errors.push('IDSP provider name is required.');
  }
  return errors;
}
