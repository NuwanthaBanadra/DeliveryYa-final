package com.kaleox.deliveryya.repo;

import com.kaleox.deliveryya.entities.Access;
import com.kaleox.deliveryya.entities.AccessHasUserRole;
import com.kaleox.deliveryya.entities.UserRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface AccessHasUserRoleRepo extends JpaRepository<AccessHasUserRole, Integer> {
    Optional<AccessHasUserRole> findByAccessAndUserRoles(Access access, UserRole userRoles);


    List<AccessHasUserRole> findAllByUserRoles(UserRole userRoles);

    /** All (!) grants of the given accesses to roles – the "who holds this access" lookup. */
    List<AccessHasUserRole> findAllByAccess_IdIn(Collection<Integer> accessIds);

    void deleteAllByUserRoles(UserRole userRoles);
}