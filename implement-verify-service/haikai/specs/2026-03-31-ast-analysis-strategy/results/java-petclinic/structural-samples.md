# Structural Samples — java-petclinic

Showing 10 of 25 complex files.

These are what the LLM receives instead of raw source code.


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/PetClinicRuntimeHints.java
```
Imports:
  org.springframework.aot.hint (RuntimeHints)
  org.springframework.aot.hint (RuntimeHintsRegistrar)
  org.springframework.samples.petclinic.model (BaseEntity)
  org.springframework.samples.petclinic.model (Person)
  org.springframework.samples.petclinic.vet (Vet)

Symbols:
  module: org.springframework.samples.petclinic
  class: PetClinicRuntimeHints extends RuntimeHintsRegistrar
    method: registerHints(RuntimeHints hints, ClassLoader classLoader)

Inheritance:
  PetClinicRuntimeHints -> RuntimeHintsRegistrar

Calls:
  PetClinicRuntimeHints.registerHints:
    -> hints.resources().registerPattern (line 29, external)
    -> hints.resources (line 29, external)
    -> hints.resources().registerPattern (line 30, external)
    -> hints.resources (line 30, external)
    -> hints.resources().registerPattern (line 31, external)
    -> hints.resources (line 31, external)
    -> hints.serialization().registerType (line 32, external)
    -> hints.serialization (line 32, external)
    -> hints.serialization().registerType (line 33, external)
    -> hints.serialization (line 33, external)
    -> hints.serialization().registerType (line 34, external)
    -> hints.serialization (line 34, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/Owner.java
```
Imports:
  java.util (ArrayList)
  java.util (List)
  java.util (Objects)
  org.springframework.core.style (ToStringCreator)
  org.springframework.samples.petclinic.model (Person)
  org.springframework.util (Assert)
  jakarta.persistence (CascadeType)
  jakarta.persistence (Column)
  jakarta.persistence (Entity)
  jakarta.persistence (FetchType)
  jakarta.persistence (JoinColumn)
  jakarta.persistence (OneToMany)
  jakarta.persistence (OrderBy)
  jakarta.persistence (Table)
  jakarta.validation.constraints (Pattern)
  jakarta.validation.constraints (NotBlank)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: Owner extends Person
    variable: address
    variable: city
    variable: telephone
    variable: pets
    method: getAddress()
    method: setAddress(String address)
    method: getCity()
    method: setCity(String city)
    method: getTelephone()
    method: setTelephone(String telephone)
    method: getPets()
    method: addPet(Pet pet)
    method: getPet(String name)
    method: getPet(Integer id)
    method: getPet(String name, boolean ignoreNew)
    method: toString()
    method: addVisit(Integer petId, Visit visit)
  variable: compId
  variable: compName
  variable: pet

Inheritance:
  Owner -> Person

Calls:
  Owner:
    -> new ArrayList (line 67, external)
  Owner.addPet:
    -> pet.isNew (line 98, external)
    -> getPets().add (line 99, external)
    -> getPets (line 99, external)
  Owner.addVisit:
    -> Assert.notNull (line 166, external)
    -> Assert.notNull (line 167, external)
    -> getPet (line 169, external)
    -> Assert.notNull (line 171, external)
    -> pet.addVisit (line 173, external)
  Owner.getPet:
    -> getPet (line 109, external)
    -> getPets (line 118, external)
    -> pet.isNew (line 119, external)
    -> pet.getId (line 120, external)
    -> Objects.equals (line 121, external)
    -> getPets (line 136, external)
    -> pet.getName (line 137, external)
    -> compName.equalsIgnoreCase (line 138, external)
    -> pet.isNew (line 139, external)
  Owner.toString:
    -> new ToStringCreator(this).append("id", this.getId())
			.append("new", this.isNew())
			.append("lastName", this.getLastName())
			.append("firstName", this.getFirstName())
			.append("address", this.address)
			.append("city", this.city)
			.append("telephone", this.telephone).toString (line 149, external)
    -> new ToStringCreator(this).append("id", this.getId())
			.append("new", this.isNew())
			.append("lastName", this.getLastName())
			.append("firstName", this.getFirstName())
			.append("address", this.address)
			.append("city", this.city).append (line 149, external)
    -> new ToStringCreator(this).append("id", this.getId())
			.append("new", this.isNew())
			.append("lastName", this.getLastName())
			.append("firstName", this.getFirstName())
			.append("address", this.address).append (line 149, external)
    -> new ToStringCreator(this).append("id", this.getId())
			.append("new", this.isNew())
			.append("lastName", this.getLastName())
			.append("firstName", this.getFirstName()).append (line 149, external)
    -> new ToStringCreator(this).append("id", this.getId())
			.append("new", this.isNew())
			.append("lastName", this.getLastName()).append (line 149, external)
    -> new ToStringCreator(this).append("id", this.getId())
			.append("new", this.isNew()).append (line 149, external)
    -> new ToStringCreator(this).append("id", this.getId()).append (line 149, external)
    -> new ToStringCreator(this).append (line 149, external)
    -> new ToStringCreator (line 149, external)
    -> this.getId (line 149, external)
    -> this.isNew (line 150, external)
    -> this.getLastName (line 151, external)
    -> this.getFirstName (line 152, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java
```
Imports:
  java.util (List)
  java.util (Objects)
  java.util (Optional)
  org.springframework.data.domain (Page)
  org.springframework.data.domain (PageRequest)
  org.springframework.data.domain (Pageable)
  org.springframework.stereotype (Controller)
  org.springframework.ui (Model)
  org.springframework.validation (BindingResult)
  org.springframework.web.bind (WebDataBinder)
  org.springframework.web.bind.annotation (GetMapping)
  org.springframework.web.bind.annotation (InitBinder)
  org.springframework.web.bind.annotation (ModelAttribute)
  org.springframework.web.bind.annotation (PathVariable)
  org.springframework.web.bind.annotation (PostMapping)
  org.springframework.web.bind.annotation (RequestParam)
  org.springframework.web.servlet (ModelAndView)
  jakarta.validation (Valid)
  org.springframework.web.servlet.mvc.support (RedirectAttributes)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: OwnerController
    variable: VIEWS_OWNER_CREATE_OR_UPDATE_FORM
    variable: owners
    method: OwnerController(OwnerRepository owners)
    method: setAllowedFields(WebDataBinder dataBinder)
    method: findOwner(@athVariablename = R, required = false) Integer ownerId)
    method: initCreationForm()
    method: processCreationForm(@alid Owner owner, BindingResult result, RedirectAttributes redirectAttributes)
    method: initFindForm()
    method: processFindForm(@equestParamdefaultValue = R) int page, Owner owner, BindingResult result, Model model)
    method: addPaginationModel(int page, Model model, Page<Owner> paginated)
    method: findPaginatedForOwnersLastName(int page, String lastname)
    method: initUpdateOwnerForm()
    method: processUpdateOwnerForm(@alid Owner owner, BindingResult result, @PathVariable(R) int ownerId, RedirectAttributes redirectAttributes)
    method: showOwner(@athVariableR) int ownerId)
  variable: lastName
  variable: ownersResults
  variable: listOwners
  variable: pageSize
  variable: pageable
  variable: mav
  variable: optionalOwner
  variable: owner

Calls:
  OwnerController.addPaginationModel:
    -> paginated.getContent (line 122, external)
    -> model.addAttribute (line 123, external)
    -> model.addAttribute (line 124, external)
    -> paginated.getTotalPages (line 124, external)
    -> model.addAttribute (line 125, external)
    -> paginated.getTotalElements (line 125, external)
    -> model.addAttribute (line 126, external)
  OwnerController.findOwner:
    -> new Owner (line 66, external)
    -> this.owners.findById(ownerId).orElseThrow (line 67, external)
    -> this.owners.findById (line 67, external)
    -> new IllegalArgumentException (line 68, external)
  OwnerController.findPaginatedForOwnersLastName:
    -> PageRequest.of (line 132, external)
    -> owners.findByLastNameStartingWith (line 133, external)
  OwnerController.processCreationForm:
    -> result.hasErrors (line 79, external)
    -> redirectAttributes.addFlashAttribute (line 80, external)
    -> this.owners.save (line 84, external)
    -> redirectAttributes.addFlashAttribute (line 85, external)
    -> owner.getId (line 86, external)
  OwnerController.processFindForm:
    -> owner.getLastName (line 98, external)
    -> findPaginatedForOwnersLastName (line 104, external)
    -> ownersResults.isEmpty (line 105, external)
    -> result.rejectValue (line 107, external)
    -> ownersResults.getTotalElements (line 111, external)
    -> ownersResults.iterator().next (line 113, external)
    -> ownersResults.iterator (line 113, external)
    -> owner.getId (line 114, external)
    -> addPaginationModel (line 118, external)
  OwnerController.processUpdateOwnerForm:
    -> result.hasErrors (line 144, external)
    -> redirectAttributes.addFlashAttribute (line 145, external)
    -> Objects.equals (line 149, external)
    -> owner.getId (line 149, external)
    -> result.rejectValue (line 150, external)
    -> redirectAttributes.addFlashAttribute (line 151, external)
    -> owner.setId (line 155, external)
    -> this.owners.save (line 156, external)
    -> redirectAttributes.addFlashAttribute (line 157, external)
  OwnerController.setAllowedFields:
    -> dataBinder.setDisallowedFields (line 61, external)
  OwnerController.showOwner:
    -> new ModelAndView (line 168, external)
    -> this.owners.findById (line 169, external)
    -> optionalOwner.orElseThrow (line 170, external)
    -> new IllegalArgumentException (line 170, external)
    -> mav.addObject (line 172, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/Pet.java
```
Imports:
  java.time (LocalDate)
  java.util (Collection)
  java.util (LinkedHashSet)
  java.util (Set)
  org.springframework.format.annotation (DateTimeFormat)
  org.springframework.samples.petclinic.model (NamedEntity)
  jakarta.persistence (CascadeType)
  jakarta.persistence (Column)
  jakarta.persistence (Entity)
  jakarta.persistence (FetchType)
  jakarta.persistence (JoinColumn)
  jakarta.persistence (ManyToOne)
  jakarta.persistence (OneToMany)
  jakarta.persistence (OrderBy)
  jakarta.persistence (Table)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: Pet extends NamedEntity
    variable: birthDate
    variable: type
    variable: visits
    method: setBirthDate(LocalDate birthDate)
    method: getBirthDate()
    method: getType()
    method: setType(PetType type)
    method: getVisits()
    method: addVisit(Visit visit)

Inheritance:
  Pet -> NamedEntity

Calls:
  Pet:
    -> new LinkedHashSet (line 59, external)
  Pet.addVisit:
    -> getVisits().add (line 82, external)
    -> getVisits (line 82, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetController.java
```
Imports:
  java.time (LocalDate)
  java.util (Collection)
  java.util (Objects)
  java.util (Optional)
  org.springframework.stereotype (Controller)
  org.springframework.ui (ModelMap)
  org.springframework.util (Assert)
  org.springframework.util (StringUtils)
  org.springframework.validation (BindingResult)
  org.springframework.web.bind (WebDataBinder)
  org.springframework.web.bind.annotation (GetMapping)
  org.springframework.web.bind.annotation (InitBinder)
  org.springframework.web.bind.annotation (ModelAttribute)
  org.springframework.web.bind.annotation (PathVariable)
  org.springframework.web.bind.annotation (PostMapping)
  org.springframework.web.bind.annotation (RequestMapping)
  jakarta.validation (Valid)
  org.springframework.web.servlet.mvc.support (RedirectAttributes)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: PetController
    variable: VIEWS_PETS_CREATE_OR_UPDATE_FORM
    variable: owners
    variable: types
    method: PetController(OwnerRepository owners, PetTypeRepository types)
    method: populatePetTypes()
    method: findOwner(@athVariableR) int ownerId)
    method: findPet(@athVariableR) int ownerId, @PathVariable(name = R, required = false) Integer petId)
    method: initOwnerBinder(WebDataBinder dataBinder)
    method: initPetBinder(WebDataBinder dataBinder)
    method: initCreationForm(Owner owner, ModelMap model)
    method: processCreationForm(Owner owner, @Valid Pet pet, BindingResult result, RedirectAttributes redirectAttributes)
    method: initUpdateForm()
    method: processUpdateForm(Owner owner, @Valid Pet pet, BindingResult result, RedirectAttributes redirectAttributes)
    method: updatePetDetails(Owner owner, Pet pet)
  variable: optionalOwner
  variable: owner
  variable: optionalOwner
  variable: owner
  variable: pet
  variable: currentDate
  variable: petName
  variable: existingPet
  variable: currentDate
  variable: id
  variable: existingPet

Calls:
  PetController.findOwner:
    -> this.owners.findById (line 68, external)
    -> optionalOwner.orElseThrow (line 69, external)
    -> new IllegalArgumentException (line 69, external)
  PetController.findPet:
    -> new Pet (line 79, external)
    -> this.owners.findById (line 82, external)
    -> optionalOwner.orElseThrow (line 83, external)
    -> new IllegalArgumentException (line 83, external)
    -> owner.getPet (line 85, external)
  PetController.initCreationForm:
    -> new Pet (line 100, external)
    -> owner.addPet (line 101, external)
  PetController.initOwnerBinder:
    -> dataBinder.setDisallowedFields (line 90, external)
  PetController.initPetBinder:
    -> dataBinder.setValidator (line 95, external)
    -> new PetValidator (line 95, external)
  PetController.populatePetTypes:
    -> this.types.findPetTypes (line 63, external)
  PetController.processCreationForm:
    -> StringUtils.hasText (line 109, external)
    -> pet.getName (line 109, external)
    -> pet.isNew (line 109, external)
    -> owner.getPet (line 109, external)
    -> pet.getName (line 109, external)
    -> result.rejectValue (line 110, external)
    -> LocalDate.now (line 113, external)
    -> pet.getBirthDate (line 114, external)
    -> pet.getBirthDate().isAfter (line 114, external)
    -> pet.getBirthDate (line 114, external)
    -> result.rejectValue (line 115, external)
    -> result.hasErrors (line 118, external)
    -> owner.addPet (line 122, external)
    -> this.owners.save (line 123, external)
    -> redirectAttributes.addFlashAttribute (line 124, external)
  PetController.processUpdateForm:
    -> pet.getName (line 137, external)
    -> StringUtils.hasText (line 140, external)
    -> owner.getPet (line 141, external)
    -> Objects.equals (line 142, external)
    -> existingPet.getId (line 142, external)
    -> pet.getId (line 142, external)
    -> result.rejectValue (line 143, external)
    -> LocalDate.now (line 147, external)
    -> pet.getBirthDate (line 148, external)
    -> pet.getBirthDate().isAfter (line 148, external)
    -> pet.getBirthDate (line 148, external)
    -> result.rejectValue (line 149, external)
    -> result.hasErrors (line 152, external)
    -> updatePetDetails (line 156, external)
    -> redirectAttributes.addFlashAttribute (line 157, external)
  PetController.updatePetDetails:
    -> pet.getId (line 167, external)
    -> Assert.state (line 168, external)
    -> owner.getPet (line 169, external)
    -> existingPet.setName (line 172, external)
    -> pet.getName (line 172, external)
    -> existingPet.setBirthDate (line 173, external)
    -> pet.getBirthDate (line 173, external)
    -> existingPet.setType (line 174, external)
    -> pet.getType (line 174, external)
    -> owner.addPet (line 177, external)
    -> this.owners.save (line 179, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetTypeFormatter.java
```
Imports:
  org.springframework.format (Formatter)
  org.springframework.stereotype (Component)
  java.text (ParseException)
  java.util (Collection)
  java.util (Locale)
  java.util (Objects)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: PetTypeFormatter extends Formatter
    variable: types
    method: PetTypeFormatter(PetTypeRepository types)
    method: print(PetType petType, Locale locale)
    method: parse(String text, Locale locale)
  variable: name
  variable: findPetTypes

Inheritance:
  PetTypeFormatter -> Formatter

Calls:
  PetTypeFormatter.parse:
    -> this.types.findPetTypes (line 53, external)
    -> Objects.equals (line 55, external)
    -> type.getName (line 55, external)
    -> new ParseException (line 59, external)
  PetTypeFormatter.print:
    -> petType.getName (line 47, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetValidator.java
```
Imports:
  org.springframework.util (StringUtils)
  org.springframework.validation (Errors)
  org.springframework.validation (Validator)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: PetValidator extends Validator
    variable: REQUIRED
    method: validate(Object obj, Errors errors)
    method: supports(Class<?> clazz)
  variable: pet
  variable: name

Inheritance:
  PetValidator -> Validator

Calls:
  PetValidator.supports:
    -> Pet.class.isAssignableFrom (line 61, external)
  PetValidator.validate:
    -> pet.getName (line 39, external)
    -> StringUtils.hasText (line 41, external)
    -> errors.rejectValue (line 42, external)
    -> pet.isNew (line 46, external)
    -> pet.getType (line 46, external)
    -> errors.rejectValue (line 47, external)
    -> pet.getBirthDate (line 51, external)
    -> errors.rejectValue (line 52, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/VisitController.java
```
Imports:
  java.util (Map)
  java.util (Optional)
  org.springframework.stereotype (Controller)
  org.springframework.validation (BindingResult)
  org.springframework.web.bind (WebDataBinder)
  org.springframework.web.bind.annotation (GetMapping)
  org.springframework.web.bind.annotation (InitBinder)
  org.springframework.web.bind.annotation (ModelAttribute)
  org.springframework.web.bind.annotation (PathVariable)
  org.springframework.web.bind.annotation (PostMapping)
  jakarta.validation (Valid)
  org.springframework.web.servlet.mvc.support (RedirectAttributes)

Symbols:
  module: org.springframework.samples.petclinic.owner
  class: VisitController
    variable: owners
    method: VisitController(OwnerRepository owners)
    method: setAllowedFields(WebDataBinder dataBinder)
    method: loadPetWithVisit(@athVariableR) int ownerId, @PathVariable(R) int petId, Map<String, Object> model)
    method: initNewVisitForm()
    method: processNewVisitForm(@odelAttribute Owner owner, @PathVariable int petId, @Valid Visit visit, BindingResult result, RedirectAttributes redirectAttributes)
  variable: optionalOwner
  variable: owner
  variable: pet
  variable: visit

Calls:
  VisitController.loadPetWithVisit:
    -> owners.findById (line 65, external)
    -> optionalOwner.orElseThrow (line 66, external)
    -> new IllegalArgumentException (line 66, external)
    -> owner.getPet (line 69, external)
    -> new IllegalArgumentException (line 71, external)
    -> model.put (line 74, external)
    -> model.put (line 75, external)
    -> new Visit (line 77, external)
    -> pet.addVisit (line 78, external)
  VisitController.processNewVisitForm:
    -> result.hasErrors (line 94, external)
    -> owner.addVisit (line 98, external)
    -> this.owners.save (line 99, external)
    -> redirectAttributes.addFlashAttribute (line 100, external)
  VisitController.setAllowedFields:
    -> dataBinder.setDisallowedFields (line 52, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/system/WebConfiguration.java
```
Imports:
  org.springframework.context.annotation (Bean)
  org.springframework.context.annotation (Configuration)
  org.springframework.web.servlet (LocaleResolver)
  org.springframework.web.servlet.config.annotation (InterceptorRegistry)
  org.springframework.web.servlet.config.annotation (WebMvcConfigurer)
  org.springframework.web.servlet.i18n (LocaleChangeInterceptor)
  org.springframework.web.servlet.i18n (SessionLocaleResolver)
  java.util (Locale)

Symbols:
  module: org.springframework.samples.petclinic.system
  class: WebConfiguration extends WebMvcConfigurer
    method: localeResolver()
    method: localeChangeInterceptor()
    method: addInterceptors(InterceptorRegistry registry)
  variable: resolver
  variable: interceptor

Inheritance:
  WebConfiguration -> WebMvcConfigurer

Calls:
  WebConfiguration.addInterceptors:
    -> registry.addInterceptor (line 57, external)
    -> localeChangeInterceptor (line 57, external)
  WebConfiguration.localeChangeInterceptor:
    -> new LocaleChangeInterceptor (line 46, external)
    -> interceptor.setParamName (line 47, external)
  WebConfiguration.localeResolver:
    -> new SessionLocaleResolver (line 34, external)
    -> resolver.setDefaultLocale (line 35, external)
```


## /tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/Vet.java
```
Imports:
  java.util (Comparator)
  java.util (HashSet)
  java.util (List)
  java.util (Set)
  java.util.stream (Collectors)
  org.springframework.samples.petclinic.model (NamedEntity)
  org.springframework.samples.petclinic.model (Person)
  jakarta.persistence (Entity)
  jakarta.persistence (FetchType)
  jakarta.persistence (JoinColumn)
  jakarta.persistence (JoinTable)
  jakarta.persistence (ManyToMany)
  jakarta.persistence (Table)
  jakarta.xml.bind.annotation (XmlElement)

Symbols:
  module: org.springframework.samples.petclinic.vet
  class: Vet extends Person
    variable: specialties
    method: getSpecialtiesInternal()
    method: getSpecialties()
    method: getNrOfSpecialties()
    method: addSpecialty(Specialty specialty)

Inheritance:
  Vet -> Person

Calls:
  Vet.addSpecialty:
    -> getSpecialtiesInternal().add (line 71, external)
    -> getSpecialtiesInternal (line 71, external)
  Vet.getNrOfSpecialties:
    -> getSpecialtiesInternal().size (line 67, external)
    -> getSpecialtiesInternal (line 67, external)
  Vet.getSpecialties:
    -> getSpecialtiesInternal().stream()
			.sorted(Comparator.comparing(NamedEntity::getName)).collect (line 61, external)
    -> getSpecialtiesInternal().stream().sorted (line 61, external)
    -> getSpecialtiesInternal().stream (line 61, external)
    -> getSpecialtiesInternal (line 61, external)
    -> Comparator.comparing (line 62, external)
    -> Collectors.toList (line 63, external)
  Vet.getSpecialtiesInternal:
    -> new HashSet (line 54, external)
```
